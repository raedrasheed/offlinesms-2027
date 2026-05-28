package app.offlinesms.business.ui

import android.app.Activity
import android.os.Bundle

/**
 * Pairing-code enrollment screen (Phase 0 placeholder).
 *
 * Phase 2: collect the one-time pairing code + device label, call
 * `enrollRelayDevice`, store the returned custom-token credentials securely,
 * then start the foreground relay service. The app must remain useless until a
 * business owner/admin links this device from the dashboard.
 */
class EnrollmentActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // TODO(phase-2): inflate enrollment UI + wire enrollRelayDevice.
    }
}
