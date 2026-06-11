package app.offlinesms.business.work

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import app.offlinesms.business.data.db.RelayDb
import app.offlinesms.business.data.db.ReportEntity
import app.offlinesms.business.util.RelayLog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit

/** Durably records a delivery result and triggers a network-gated flush. */
object Reporter {
    fun enqueue(context: Context, jobId: String, status: String, reason: String?, resultCode: Int?) {
        val app = context.applicationContext
        val db = RelayDb.get(app)
        CoroutineScope(Dispatchers.IO).launch {
            val now = System.currentTimeMillis()
            db.reports().insert(
                ReportEntity(jobId = jobId, status = status, reason = reason,
                    androidResultCode = resultCode, simSubscriptionId = null, createdAt = now),
            )
            // Privacy: drop the body once the send reaches a terminal-ish state.
            db.jobs().finalize(jobId, status, now)
            RelayLog.info(app, status, "job=$jobId")
            kickFlush(app)
        }
    }

    fun kickFlush(context: Context) {
        val req = OneTimeWorkRequestBuilder<SyncReportsWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork("relay-report-sync", ExistingWorkPolicy.APPEND_OR_REPLACE, req)
    }
}
