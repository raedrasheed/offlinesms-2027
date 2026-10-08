package app.offlinesms.business.net

import com.google.firebase.functions.ktx.functions
import com.google.firebase.ktx.Firebase

/** A relay job handed to this device to send. */
data class ClaimedJob(
    val jobId: String,
    val phoneE164: String,
    val body: String,
    val simSubscriptionId: Int?,
    val traceId: String,
    /** e.g. "phone_auth_otp" / "phone_link_otp" for verification codes; null for business SMS. */
    val kind: String? = null,
    /** Must call [RelayApi.authorizeSend] and get ok right before sending. */
    val requiresSendAuth: Boolean = false,
    /** Verification jobs: must not be sent later than this many ms after receipt. */
    val sendWithinMs: Long? = null,
)

/** Server answer to authorizeRelaySend. */
data class SendAuthorization(val ok: Boolean, val reason: String?)

/** Declared to the server so it hands this build verification-code jobs. */
const val SEND_AUTH_CAPABILITY = "send-auth-v1"

data class EnrollResult(val deviceId: String, val businessId: String, val customToken: String)

/**
 * Thin wrapper over the relay Cloud Function callables (region us-central1),
 * matching functions/src/sms/relay*.ts. enroll runs before sign-in (the device
 * has no identity yet); the rest run with the custom-token session.
 */
object RelayApi {
    private val functions get() = Firebase.functions("us-central1")

    suspend fun enroll(
        pairingCode: String,
        deviceLabel: String,
        fcmToken: String,
        appVersion: String,
        androidInfo: Map<String, Any?>,
        simInfo: List<Map<String, Any?>>,
    ): EnrollResult {
        val data = mapOf(
            "pairingCode" to pairingCode,
            "deviceLabel" to deviceLabel,
            "fcmToken" to fcmToken,
            "appVersion" to appVersion,
            "androidInfo" to androidInfo,
            "simInfo" to simInfo,
        )
        @Suppress("UNCHECKED_CAST")
        val res = functions.getHttpsCallable("enrollRelayDevice").call(data).awaitResult().data as Map<String, Any?>
        return EnrollResult(
            deviceId = res["deviceId"] as String,
            businessId = res["businessId"] as String,
            customToken = res["customToken"] as String,
        )
    }

    suspend fun claim(deviceId: String, capacity: Int): List<ClaimedJob> {
        val data = mapOf(
            "deviceId" to deviceId, "capacity" to capacity,
            "clientCaps" to listOf(SEND_AUTH_CAPABILITY),
        )
        @Suppress("UNCHECKED_CAST")
        val res = functions.getHttpsCallable("claimRelayJobs").call(data).awaitResult().data as Map<String, Any?>
        val jobs = (res["jobs"] as? List<*>).orEmpty()
        return jobs.mapNotNull { raw ->
            val m = raw as? Map<*, *> ?: return@mapNotNull null
            ClaimedJob(
                jobId = m["jobId"] as? String ?: return@mapNotNull null,
                phoneE164 = m["phoneE164"] as? String ?: return@mapNotNull null,
                body = m["messageBody"] as? String ?: "",
                simSubscriptionId = (m["assignedSimSubscriptionId"] as? Number)?.toInt(),
                traceId = m["traceId"] as? String ?: "",
                kind = m["kind"] as? String,
                requiresSendAuth = m["requiresSendAuth"] as? Boolean ?: false,
                sendWithinMs = (m["sendWithinMs"] as? Number)?.toLong(),
            )
        }
    }

    /** Final server check immediately before the SmsManager hand-off. Throws on
     *  network/server failure — callers must treat that as "do not send". */
    suspend fun authorizeSend(deviceId: String, jobId: String): SendAuthorization {
        val data = mapOf("deviceId" to deviceId, "jobId" to jobId)
        @Suppress("UNCHECKED_CAST")
        val res = functions.getHttpsCallable("authorizeRelaySend").call(data).awaitResult().data as Map<String, Any?>
        return SendAuthorization(ok = res["ok"] == true, reason = res["reason"] as? String)
    }

    suspend fun report(
        deviceId: String, jobId: String, status: String,
        reason: String?, androidResultCode: Int?, simSubscriptionId: Int?,
    ) {
        val data = mapOf(
            "deviceId" to deviceId, "jobId" to jobId, "status" to status,
            "reason" to reason, "androidResultCode" to androidResultCode,
            "simSubscriptionId" to simSubscriptionId,
            "timestamp" to java.time.Instant.now().toString(),
        )
        functions.getHttpsCallable("reportRelayDelivery").call(data).awaitResult()
    }

    /** Liveness + informational telemetry. Never carries send counters: the
     *  server owns capacity accounting (older builds sent 0/0 here, which reset
     *  the server's daily counter). */
    suspend fun heartbeat(
        deviceId: String, fcmToken: String, appVersion: String,
        simInfo: List<Map<String, Any?>>, queueDepth: Int, lastError: String?,
    ) {
        val data = mapOf(
            "deviceId" to deviceId, "fcmToken" to fcmToken, "appVersion" to appVersion,
            "simInfo" to simInfo, "queueDepth" to queueDepth, "lastError" to lastError,
        )
        functions.getHttpsCallable("relayHeartbeat").call(data).awaitResult()
    }
}
