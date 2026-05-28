package app.offlinesms.business.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import app.offlinesms.business.data.SecureStore

/** Restart the relay after a device reboot (only if already enrolled). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        if (SecureStore.get(context).isEnrolled) RelayService.start(context)
    }
}
