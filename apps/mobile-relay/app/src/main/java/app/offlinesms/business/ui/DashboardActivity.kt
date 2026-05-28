package app.offlinesms.business.ui

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import app.offlinesms.business.R
import app.offlinesms.business.data.SecureStore
import app.offlinesms.business.data.db.RelayDb
import app.offlinesms.business.service.RelayService
import com.google.firebase.auth.ktx.auth
import com.google.firebase.ktx.Firebase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Relay status + pause/resume + recent logs (no message bodies). */
class DashboardActivity : AppCompatActivity() {
    private lateinit var store: SecureStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = SecureStore.get(this)
        if (!store.isEnrolled) { startActivity(Intent(this, EnrollmentActivity::class.java)); finish(); return }
        setContentView(R.layout.activity_dashboard)

        findViewById<TextView>(R.id.deviceText).text = getString(R.string.dash_device, store.deviceId ?: "?")
        findViewById<TextView>(R.id.businessText).text = getString(R.string.dash_business, store.businessId ?: "?")

        val pauseBtn = findViewById<Button>(R.id.pauseBtn)
        fun refreshPauseLabel() { pauseBtn.text = getString(if (store.paused) R.string.dash_resume else R.string.dash_pause) }
        refreshPauseLabel()
        pauseBtn.setOnClickListener {
            store.paused = !store.paused
            RelayService.start(this, if (store.paused) RelayService.ACTION_PAUSE else RelayService.ACTION_RESUME)
            refreshPauseLabel()
            findViewById<TextView>(R.id.statusText).text = getString(if (store.paused) R.string.relay_paused else R.string.relay_active)
        }

        findViewById<Button>(R.id.revokeBtn).setOnClickListener {
            RelayService.start(this, RelayService.ACTION_STOP)
            Firebase.auth.signOut()
            store.clear()
            startActivity(Intent(this, EnrollmentActivity::class.java)); finish()
        }

        findViewById<TextView>(R.id.statusText).text = getString(if (store.paused) R.string.relay_paused else R.string.relay_active)
        loadStats()
    }

    private fun loadStats() {
        lifecycleScope.launch {
            val db = RelayDb.get(this@DashboardActivity)
            val pending = withContext(Dispatchers.IO) { db.jobs().pendingCount() }
            val logs = withContext(Dispatchers.IO) { db.logs().recent() }
            findViewById<TextView>(R.id.queueText).text = getString(R.string.dash_queue, pending)
            findViewById<TextView>(R.id.logsText).text = logs.take(40).joinToString("\n") {
                "${it.event}${it.detail?.let { d -> " · $d" } ?: ""}"
            }
        }
    }

    override fun onResume() { super.onResume(); if (store.isEnrolled) loadStats() }
}
