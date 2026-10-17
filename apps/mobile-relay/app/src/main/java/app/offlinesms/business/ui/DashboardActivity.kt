package app.offlinesms.business.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ListView
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import app.offlinesms.business.R
import app.offlinesms.business.data.SecureStore
import app.offlinesms.business.data.db.RelayDb
import app.offlinesms.business.data.db.LogEntity
import com.google.android.material.button.MaterialButton
import app.offlinesms.business.service.RelayService
import com.google.firebase.auth.ktx.auth
import com.google.firebase.ktx.Firebase
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.distinctUntilChanged

/** Relay status + pause/resume + recent logs (no message bodies). */
class DashboardActivity : AppCompatActivity() {
    private lateinit var store: SecureStore
    private lateinit var header: View
    private lateinit var activityList: ListView
    private lateinit var activityAdapter: RelayActivityAdapter
    private var recentLogs: List<LogEntity> = emptyList()
    private var problemsOnly = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = SecureStore.get(this)
        if (!store.isEnrolled) { startActivity(Intent(this, EnrollmentActivity::class.java)); finish(); return }
        setContentView(R.layout.activity_dashboard)
        activityList = findViewById(R.id.activityList)
        header = layoutInflater.inflate(R.layout.dashboard_header, activityList, false)
        activityList.addHeaderView(header, null, false)
        activityAdapter = RelayActivityAdapter(this)
        activityList.adapter = activityAdapter
        problemsOnly = savedInstanceState?.getBoolean("problemsOnly") ?: false
        header.findViewById<MaterialButton>(R.id.logsAllBtn).isChecked = !problemsOnly
        header.findViewById<MaterialButton>(R.id.logsProblemsBtn).isChecked = problemsOnly
        header.findViewById<View>(R.id.logsAllBtn).setOnClickListener { problemsOnly = false; renderLogs() }
        header.findViewById<View>(R.id.logsProblemsBtn).setOnClickListener { problemsOnly = true; renderLogs() }

        header.findViewById<TextView>(R.id.deviceText).text = getString(R.string.dash_device, store.deviceId ?: "?")
        header.findViewById<TextView>(R.id.businessText).text = getString(R.string.dash_business, store.businessId ?: "?")

        val pauseBtn = header.findViewById<Button>(R.id.pauseBtn)
        fun refreshPauseLabel() { pauseBtn.text = getString(if (store.paused) R.string.dash_resume else R.string.dash_pause) }
        refreshPauseLabel()
        pauseBtn.setOnClickListener {
            store.paused = !store.paused
            RelayService.start(this, if (store.paused) RelayService.ACTION_PAUSE else RelayService.ACTION_RESUME)
            refreshPauseLabel()
            header.findViewById<TextView>(R.id.statusText).text = getString(if (store.paused) R.string.relay_paused else R.string.relay_active)
        }

        header.findViewById<Button>(R.id.revokeBtn).setOnClickListener {
            RelayService.start(this, RelayService.ACTION_STOP)
            Firebase.auth.signOut()
            store.clear()
            startActivity(Intent(this, EnrollmentActivity::class.java)); finish()
        }

        header.findViewById<TextView>(R.id.statusText).text = getString(if (store.paused) R.string.relay_paused else R.string.relay_active)
        setupBatteryWarning()
        observeStats()
    }

    /** OEM survival: warn if battery optimization could kill the background relay. */
    private fun setupBatteryWarning() {
        val warn = header.findViewById<android.view.View>(R.id.batteryWarn)
        val pm = getSystemService(android.os.PowerManager::class.java)
        val ignoring = pm?.isIgnoringBatteryOptimizations(packageName) == true
        warn.visibility = if (ignoring) android.view.View.GONE else android.view.View.VISIBLE
        header.findViewById<Button>(R.id.batteryFixBtn).setOnClickListener {
            // Opens the system battery-optimization list (no special permission).
            try { startActivity(Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
            catch (_: Exception) { startActivity(Intent(android.provider.Settings.ACTION_SETTINGS)) }
        }
    }

    private fun observeStats() {
        val db = RelayDb.get(this)
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    db.jobs().observePendingCount().distinctUntilChanged().catch {
                        header.findViewById<TextView>(R.id.queueText).text = getString(R.string.logs_load_error)
                    }.collect { pending ->
                        header.findViewById<TextView>(R.id.queueText).text = getString(R.string.dash_queue, pending)
                    }
                }
                launch {
                    db.logs().observeRecent().distinctUntilChanged().catch {
                        header.findViewById<TextView>(R.id.logsEmptyText).apply {
                            text = getString(R.string.logs_load_error); visibility = View.VISIBLE
                        }
                    }.collect { logs -> recentLogs = logs; renderLogs() }
                }
            }
        }
    }

    private fun renderLogs() {
        // Keep the event being read in place when a new event arrives above it.
        val oldIndex = activityList.firstVisiblePosition - activityList.headerViewsCount
        val anchor = if (oldIndex in 0 until activityAdapter.count) activityAdapter.getItemId(oldIndex) else null
        val top = activityList.getChildAt(0)?.top ?: 0
        activityAdapter.submit(recentLogs, problemsOnly)
        header.findViewById<MaterialButton>(R.id.logsAllBtn).isChecked = !problemsOnly
        header.findViewById<MaterialButton>(R.id.logsProblemsBtn).isChecked = problemsOnly
        header.findViewById<TextView>(R.id.logsEmptyText).apply {
            text = getString(if (problemsOnly) R.string.logs_no_problems else R.string.logs_empty)
            visibility = if (activityAdapter.count == 0) View.VISIBLE else View.GONE
        }
        if (anchor != null) {
            val index = activityAdapter.indexOf(anchor)
            if (index >= 0) activityList.setSelectionFromTop(index + activityList.headerViewsCount, top)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean("problemsOnly", problemsOnly)
        super.onSaveInstanceState(outState)
    }

    override fun onResume() {
        super.onResume()
        if (store.isEnrolled) setupBatteryWarning()
    }
}
