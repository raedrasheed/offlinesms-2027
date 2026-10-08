package app.offlinesms.business.service

import app.offlinesms.business.net.ClaimedJob
import app.offlinesms.business.net.SendAuthorization

/**
 * The relay's claim → authorize → hand-off loop, Android-free so it can be run
 * against fakes on a plain JVM (and adapted to Room / RelayApi / SmsManager in
 * RelayService). Rules, applied to every job in order:
 *
 *  Deadlines (verification codes) — monotonic clock only, never wall time:
 *   • the claim budget starts when the claim REQUEST was sent (not when the
 *     response arrived), so response latency shortens it instead of extending it;
 *   • authorization returns its own budget, started when the authorization
 *     request was sent; the effective deadline is the smaller of the two, minus
 *     a safety margin;
 *   • the deadline and the pause flag are checked again AFTER the durable
 *     'sending' write, immediately before the hand-off.
 *   No answer from authorization (network loss, timeout) ⇒ no send (fail closed).
 *
 *  Local de-duplication — by (jobId, server attempt):
 *   • the same attempt delivered twice (re-claim, concurrent wake/poll, restart)
 *     is never handed off again;
 *   • a NEW attempt of a business SMS (the server re-queued it after a pause
 *     before hand-off, a lapsed lease, or a transient carrier failure) is allowed
 *     — that is the server's retry contract;
 *   • a new attempt is refused (reported as ambiguous, which the server treats as
 *     permanent) when this device may already have handed the logical job to the
 *     modem: local state 'sending'/'sent'/'delivered', OR the sticky noResend
 *     mark. noResend is written durably (in the same transaction as the report)
 *     BEFORE the report is queued, and nothing clears it — so a report being
 *     offline, its local finalize to 'failed', a restart or further attempts
 *     never turn the job back into a retryable one (M1);
 *   • verification codes are never sent twice: the server never re-queues them,
 *     and a new attempt for one is refused here as well.
 *
 * Not guaranteed (documented): exactly-once carrier delivery, and anything
 * between the final check and SmsManager accepting the message.
 */
class SendPipeline(
    private val backend: Backend,
    private val local: LocalJobs,
    private val transport: Transport,
    private val reports: Reports,
    private val clock: Clock,
    private val pause: Pause,
    private val pacer: suspend () -> Unit = {},
) {
    interface Backend {
        suspend fun claim(capacity: Int): List<ClaimedJob>
        /** Throws on network/server failure. */
        suspend fun authorize(jobId: String): SendAuthorization
    }

    data class LocalJob(val jobId: String, val attempt: Int, val localStatus: String, val noResend: Boolean = false)

    interface LocalJobs {
        suspend fun get(jobId: String): LocalJob?
        /** Insert, or replace the row for a newer attempt. */
        suspend fun put(job: ClaimedJob, localStatus: String)
        /** Status of THIS attempt's row only. */
        suspend fun setStatus(jobId: String, attempt: Int, localStatus: String)
    }

    interface Transport { fun send(job: ClaimedJob) }
    interface Reports {
        /** Durably records a not-sent / ambiguous outcome for ONE attempt; with
         *  [noResend] the logical job is marked never-resend in the same write.
         *  Returns only after the write — flushing to the server is separate. */
        suspend fun failed(jobId: String, attempt: Int, reason: String, noResend: Boolean)
    }
    interface Clock { fun elapsedMs(): Long }
    interface Pause { val paused: Boolean }

    sealed interface Outcome {
        data class Sent(val jobId: String) : Outcome
        data class Skipped(val jobId: String, val reason: String) : Outcome
        data class Failed(val jobId: String, val reason: String) : Outcome
        data class StoppedBatch(val jobId: String) : Outcome
    }

    companion object {
        /** Kept back from every deadline for local processing before the hand-off. */
        const val SAFETY_MARGIN_MS = 1_500L
        /** Local states that mean "this device may already have handed it off". */
        private val POSSIBLY_HANDED_OFF = setOf("sending", "sent", "delivered")

        /** Pure: should this hand-out be processed, given the local record? */
        fun dedup(existing: LocalJob?, job: ClaimedJob): String? = when {
            existing == null -> null
            existing.attempt >= job.attempt -> "duplicate-local"
            job.requiresSendAuth -> "verification-never-resent"
            existing.noResend || existing.localStatus in POSSIBLY_HANDED_OFF -> "ambiguous-handoff"
            else -> null
        }

        fun deadline(startedAtMs: Long, budgetMs: Long?): Long? =
            budgetMs?.let { startedAtMs + it - SAFETY_MARGIN_MS }
    }

    suspend fun runOnce(capacity: Int): List<Outcome> {
        if (pause.paused) return emptyList()
        val claimStartedAt = clock.elapsedMs()
        val jobs = backend.claim(capacity)
        val out = ArrayList<Outcome>()
        for (job in jobs) {
            val o = process(job, claimStartedAt)
            out += o
            if (o is Outcome.StoppedBatch) break
            if (o is Outcome.Sent) pacer()
        }
        return out
    }

    private suspend fun process(job: ClaimedJob, claimStartedAt: Long): Outcome {
        if (pause.paused) return Outcome.StoppedBatch(job.jobId)

        when (val d = dedup(local.get(job.jobId), job)) {
            null -> local.put(job, "claimed")
            "ambiguous-handoff" -> return fail(job, d, noResend = true)
            else -> return Outcome.Skipped(job.jobId, d)
        }

        var sendBy: Long? = null
        if (job.requiresSendAuth) {
            sendBy = deadline(claimStartedAt, job.sendWithinMs)
                ?: return fail(job, "no-deadline")
            if (clock.elapsedMs() >= sendBy) return fail(job, "expired-on-device")
            val authStartedAt = clock.elapsedMs()
            val auth = try { backend.authorize(job.jobId) } catch (_: Exception) { null }
                ?: return fail(job, "auth-unavailable")
            if (!auth.ok) {
                local.setStatus(job.jobId, job.attempt, "skipped")
                return Outcome.Skipped(job.jobId, "not-authorized:${auth.reason ?: "unknown"}")
            }
            val authBy = deadline(authStartedAt, auth.sendWithinMs) ?: return fail(job, "no-deadline")
            sendBy = minOf(sendBy, authBy)
            if (pause.paused) return fail(job, "paused-after-auth")
            if (clock.elapsedMs() >= sendBy) return fail(job, "expired-on-device")
        }

        // Durable 'sending' BEFORE the hand-off: after a crash this attempt is
        // treated as possibly handed off and is never resent.
        local.setStatus(job.jobId, job.attempt, "sending")

        // Last practical check, after the (suspending) durable write.
        if (pause.paused) {
            return if (job.requiresSendAuth) fail(job, "paused-after-auth")
            else { local.setStatus(job.jobId, job.attempt, "paused"); Outcome.StoppedBatch(job.jobId) }
        }
        if (sendBy != null && clock.elapsedMs() >= sendBy) return fail(job, "expired-on-device")

        return try {
            transport.send(job)
            Outcome.Sent(job.jobId)
        } catch (e: Exception) {
            // The send call itself failed. Whether any part was already accepted
            // can't be known here, so it is treated as possibly sent: never retried.
            fail(job, "ambiguous-send-exception", noResend = true)
        }
    }

    /** Durable outcome first (awaited), then the in-memory result. */
    private suspend fun fail(job: ClaimedJob, reason: String, noResend: Boolean = false): Outcome {
        reports.failed(job.jobId, job.attempt, reason, noResend)
        return Outcome.Failed(job.jobId, reason)
    }
}
