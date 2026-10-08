package app.offlinesms.business.net

import com.google.firebase.functions.ktx.functions
import com.google.firebase.ktx.Firebase

data class EnrollResult(val deviceId: String, val businessId: String, val customToken: String)

/** The callable transport. Production: Firebase Functions; tests: an in-memory fake server. */
fun interface Callables {
    suspend fun call(name: String, data: Map<String, Any?>): Any?
}

/**
 * Thin wrapper over the relay Cloud Function callables (region us-central1),
 * matching functions/src/sms/relay*.ts. enroll runs before sign-in (the device
 * has no identity yet); the rest run with the custom-token session.
 */
object RelayApi {
    /** Swappable for integration tests only (fake transport, no network). */
    @Volatile var callables: Callables = Callables { name, data ->
        Firebase.functions("us-central1").getHttpsCallable(name).call(data).awaitResult().data
    }

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
        val res = callables.call("enrollRelayDevice", data) as Map<String, Any?>
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
        return parseClaimedJobs(callables.call("claimRelayJobs", data))
    }

    /** Final server check immediately before the SmsManager hand-off. Throws on
     *  network/server failure — callers must treat that as "do not send". */
    suspend fun authorizeSend(deviceId: String, jobId: String): SendAuthorization {
        val data = mapOf("deviceId" to deviceId, "jobId" to jobId)
        return parseSendAuthorization(callables.call("authorizeRelaySend", data))
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
        callables.call("reportRelayDelivery", data)
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
        callables.call("relayHeartbeat", data)
    }
}
