package app.offlinesms.business.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.lifecycle.lifecycleScope
import app.offlinesms.business.R
import app.offlinesms.business.data.SecureStore
import app.offlinesms.business.net.RelayApi
import app.offlinesms.business.net.awaitResult
import app.offlinesms.business.service.RelayService
import app.offlinesms.business.util.RelayLog
import com.google.firebase.auth.ktx.auth
import com.google.firebase.ktx.Firebase
import com.google.firebase.messaging.ktx.messaging
import kotlinx.coroutines.launch

/** Pairing-code enrollment. The relay does nothing until this succeeds. */
class EnrollmentActivity : AppCompatActivity() {
    private lateinit var store: SecureStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = SecureStore.get(this)
        if (store.isEnrolled) { goToDashboard(); return }

        setContentView(R.layout.activity_enrollment)
        requestRuntimePermissions()

        val code = findViewById<EditText>(R.id.codeInput)
        val label = findViewById<EditText>(R.id.labelInput)
        val btn = findViewById<Button>(R.id.enrollBtn)
        val status = findViewById<TextView>(R.id.statusText)

        btn.setOnClickListener {
            val pairing = code.text.toString().trim().uppercase()
            if (pairing.length < 6) { status.text = getString(R.string.enroll_invalid); return@setOnClickListener }
            btn.isEnabled = false
            status.text = getString(R.string.enroll_working)
            lifecycleScope.launch { doEnroll(pairing, label.text.toString().ifBlank { "Relay device" }, btn, status) }
        }
    }

    private suspend fun doEnroll(pairing: String, label: String, btn: Button, status: TextView) {
        try {
            val fcmToken = Firebase.messaging.token.awaitResult()
            val androidInfo = mapOf(
                "manufacturer" to Build.MANUFACTURER,
                "model" to Build.MODEL,
                "androidVersion" to Build.VERSION.RELEASE,
            )
            val result = RelayApi.enroll(pairing, label, fcmToken, appVersion(), androidInfo, emptyList())
            // Sign in as the device principal (carries relay claims).
            Firebase.auth.signInWithCustomToken(result.customToken).awaitResult()
            store.deviceId = result.deviceId
            store.businessId = result.businessId
            store.paused = false
            RelayLog.info(this, "enroll", "device=${result.deviceId}")
            RelayService.start(this)
            goToDashboard()
        } catch (e: Exception) {
            btn.isEnabled = true
            status.text = getString(R.string.enroll_failed, e.message ?: "error")
            RelayLog.error(this, "enroll", e.message?.take(80))
        }
    }

    private fun appVersion(): String =
        try { packageManager.getPackageInfo(packageName, 0).versionName ?: "?" } catch (_: Exception) { "?" }

    private fun goToDashboard() {
        startActivity(Intent(this, DashboardActivity::class.java))
        finish()
    }

    private fun requestRuntimePermissions() {
        val needed = mutableListOf(Manifest.permission.SEND_SMS, Manifest.permission.READ_PHONE_STATE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) needed.add(Manifest.permission.POST_NOTIFICATIONS)
        val missing = needed.filter { ActivityCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) ActivityCompat.requestPermissions(this, missing.toTypedArray(), 1)
    }
}
