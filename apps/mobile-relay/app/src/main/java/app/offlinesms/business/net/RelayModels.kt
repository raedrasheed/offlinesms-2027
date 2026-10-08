package app.offlinesms.business.net

/*
 * Plain data models shared by the network layer and the Android-free send
 * pipeline (no Android/Firebase imports, so the pipeline compiles and is
 * tested on a plain JVM too).
 */

/** A relay job handed to this device to send. */
data class ClaimedJob(
    val jobId: String,
    val phoneE164: String,
    val body: String,
    val simSubscriptionId: Int?,
    val traceId: String,
    /** e.g. "phone_auth_otp" / "phone_link_otp" for verification codes; null for business SMS. */
    val kind: String? = null,
    /** Must call authorizeRelaySend and get ok right before sending. */
    val requiresSendAuth: Boolean = false,
    /** Verification jobs: remaining lifetime (ms) when the server built the response. */
    val sendWithinMs: Long? = null,
    /** Server attempt number for this hand-out (1, 2, …); 0 from older servers. */
    val attempt: Int = 0,
)

/** Server answer to authorizeRelaySend. [sendWithinMs] bounds how long the "ok" stays usable. */
data class SendAuthorization(val ok: Boolean, val reason: String?, val sendWithinMs: Long? = null)

/** Declared to the server so it hands this build verification-code jobs. */
const val SEND_AUTH_CAPABILITY = "send-auth-v1"

/** Parses the claimRelayJobs response (shape: functions/src/sms/relayJobs.ts ClaimedRelayJob;
 *  contract fixture: app/src/test/resources/relay-contract/claim-response.json). */
fun parseClaimedJobs(res: Any?): List<ClaimedJob> {
    val jobs = ((res as? Map<*, *>)?.get("jobs") as? List<*>).orEmpty()
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
            attempt = (m["attempt"] as? Number)?.toInt() ?: 0,
        )
    }
}

/** Parses the authorizeRelaySend response. Anything but an explicit `ok: true` is a refusal. */
fun parseSendAuthorization(res: Any?): SendAuthorization {
    val m = res as? Map<*, *> ?: return SendAuthorization(false, "malformed-response")
    return SendAuthorization(
        ok = m["ok"] == true,
        reason = m["reason"] as? String,
        sendWithinMs = (m["sendWithinMs"] as? Number)?.toLong(),
    )
}
