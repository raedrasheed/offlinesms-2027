package app.offlinesms.business.fcm

import app.offlinesms.business.data.SecureStore
import app.offlinesms.business.service.RelayService
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** Low-latency wake: when the backend dispatches jobs it pushes a data message;
 *  we nudge the relay service to claim immediately (it also polls on its tick). */
class RelayFcmService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        if (!SecureStore.get(this).isEnrolled) return
        if (message.data["type"] == "relay_wake") {
            RelayService.start(this, RelayService.ACTION_WAKE)
        }
    }

    override fun onNewToken(token: String) {
        // Next heartbeat carries the refreshed token; nothing to do here.
    }
}
