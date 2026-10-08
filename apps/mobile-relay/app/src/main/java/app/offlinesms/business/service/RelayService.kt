package app.offlinesms.business.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import app.offlinesms.business.R
import app.offlinesms.business.data.SecureStore
import app.offlinesms.business.net.ClaimedJob
import app.offlinesms.business.data.db.RelayDb
import app.offlinesms.business.net.RelayApi
import app.offlinesms.business.sms.SmsEngine
import app.offlinesms.business.util.RelayLog
import app.offlinesms.business.work.ReportStore
import com.google.firebase.auth.ktx.auth
import com.google.firebase.ktx.Firebase
import com.google.firebase.messaging.ktx.messaging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import android.os.SystemClock
import app.offlinesms.business.net.awaitResult

/**
 * Always-on foreground relay. Claims jobs for this device, sends them via the
 * SIM with conservative pacing, and heartbeats so the dashboard shows it online.
 * Results are reported by SmsResultReceiver → Reporter (durable). The relay does
 * nothing until the device is enrolled.
 */
class RelayService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var store: SecureStore
    /** One claim/send loop at a time: FCM wake, the poll tick and RESUME can
     *  all call claimOnce concurrently; tryLock makes the extra callers no-ops
     *  (the old @Volatile flag was check-then-set, not atomic). */
    private val sendLock = Mutex()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        store = SecureStore.get(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIF_ID, buildNotification())
        }
        scope.launch { loop() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_WAKE -> scope.launch { claimOnce() }
            ACTION_PAUSE -> { store.paused = true; updateNotification() }
            ACTION_RESUME -> { store.paused = false; updateNotification(); scope.launch { claimOnce() } }
            ACTION_STOP -> { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
        }
        return START_STICKY
    }

    private suspend fun loop() {
        var tick = 0
        while (true) {
            if (store.isEnrolled && Firebase.auth.currentUser != null) {
                if (!store.paused) claimOnce()
                if (tick % HEARTBEAT_EVERY == 0) heartbeatOnce()
            }
            tick++
            delay(TICK_MS)
        }
    }

    private suspend fun claimOnce() {
        val deviceId = store.deviceId ?: return
        if (store.paused || Firebase.auth.currentUser == null) return
        if (!sendLock.tryLock()) return
        try {
            val outcomes = pipeline(deviceId).runOnce(CLAIM_CAPACITY)
            if (outcomes.isNotEmpty()) {
                RelayLog.info(this, "claim", "n=${outcomes.size}")
                updateNotification()
            }
        } catch (e: Exception) {
            RelayLog.warn(this, "claim", "err: ${e.message?.take(80)}")
        } finally {
            sendLock.unlock()
        }
    }

    /** Production send loop (see relayPipeline): Room + RelayApi + SmsManager + Reporter. */
    private fun pipeline(deviceId: String): SendPipeline {
        val ctx = this
        return relayPipeline(
            deviceId = deviceId,
            db = RelayDb.get(this),
            transport = object : SendPipeline.Transport {
                override fun send(job: ClaimedJob) {
                    SmsEngine.send(ctx, job)
                    RelayLog.info(ctx, "send", "job=${job.jobId} to=${RelayLog.maskPhone(job.phoneE164)}")
                }
            },
            reports = StoreReports(ReportStore(RelayDb.get(this))) { jobId, reason ->
                RelayLog.info(ctx, "not-sent", "job=$jobId $reason")
                app.offlinesms.business.work.Reporter.kickFlush(ctx)
            },
            clock = object : SendPipeline.Clock { override fun elapsedMs() = SystemClock.elapsedRealtime() },
            pause = object : SendPipeline.Pause { override val paused get() = store.paused },
            pacer = { delay(PACING_MS) }, // carrier-friendly spacing; server enforces minute/hour/day caps
        )
    }

    private suspend fun heartbeatOnce() {
        val deviceId = store.deviceId ?: return
        try {
            val token = Firebase.messaging.token.awaitResult()
            val pending = RelayDb.get(this).jobs().pendingCount()
            RelayApi.heartbeat(deviceId, token, appVersion(), emptyList(), pending,
                if (store.paused) "paused" else null)
        } catch (e: Exception) {
            RelayLog.warn(this, "heartbeat", e.message?.take(60))
        }
    }

    private fun appVersion(): String =
        try { packageManager.getPackageInfo(packageName, 0).versionName ?: "?" } catch (_: Exception) { "?" }

    private fun buildNotification(): Notification {
        val mgr = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            mgr.createNotificationChannel(
                NotificationChannel(CHANNEL, "Relay status", NotificationManager.IMPORTANCE_LOW),
            )
        }
        val text = if (store.paused) getString(R.string.relay_paused) else getString(R.string.relay_active)
        return NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification() {
        getSystemService(NotificationManager::class.java).notify(NOTIF_ID, buildNotification())
    }

    override fun onDestroy() { scope.cancel(); super.onDestroy() }

    companion object {
        private const val CHANNEL = "relay"
        private const val NOTIF_ID = 1001
        private const val TICK_MS = 20_000L
        private const val HEARTBEAT_EVERY = 3          // ~every 60s
        private const val PACING_MS = 4_000L           // conservative anti-spam spacing
        private const val CLAIM_CAPACITY = 5

        const val ACTION_WAKE = "app.offlinesms.business.WAKE"
        const val ACTION_PAUSE = "app.offlinesms.business.PAUSE"
        const val ACTION_RESUME = "app.offlinesms.business.RESUME"
        const val ACTION_STOP = "app.offlinesms.business.STOP"

        fun start(context: Context, action: String? = null) {
            val i = Intent(context, RelayService::class.java).also { if (action != null) it.action = action }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(i)
            else context.startService(i)
        }
    }
}
