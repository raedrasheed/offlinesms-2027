package app.offlinesms.business.service

/**
 * Pure (Android-free) send-boundary rules for the relay, so they can be unit
 * tested on the JVM. RelayService applies them to every job, in order, right
 * before the SmsManager hand-off.
 *
 *  1. Local pause is checked before EVERY job, not only before the claim.
 *  2. A job already present in the local DB (Room insert IGNORE returned -1) is
 *     never sent again — duplicate delivery from a re-claim, a concurrent
 *     wake/poll, or a restart can't trigger a second hand-off.
 *  3. Verification-code jobs carry a server deadline relative to receipt
 *     (measured with the monotonic clock, not wall time) and must obtain a
 *     fresh server authorization (authorizeRelaySend). No answer (network
 *     error) means NO send — fail closed.
 *
 * Not guaranteed: exactly-once carrier delivery. A crash after the hand-off but
 * before the result arrives leaves the job ambiguous; it is never resent.
 */
object SendGate {
    sealed interface Decision {
        /** Hand to SmsManager now. */
        data object Send : Decision
        /** Ask the server (authorizeRelaySend) first. */
        data object NeedsAuthorization : Decision
        /** Stop processing the rest of this batch (local pause). */
        data object StopBatch : Decision
        /** Don't send; nothing to report (already handled locally). */
        data class Skip(val reason: String) : Decision
        /** Don't send; report the job failed with this reason. */
        data class Fail(val reason: String) : Decision
    }

    data class Candidate(
        val jobId: String,
        val requiresSendAuth: Boolean,
        /** Server-provided budget (ms) from receipt; null for non-verification jobs. */
        val sendWithinMs: Long?,
        /** SystemClock.elapsedRealtime() when the claim response was received. */
        val receivedAtElapsedMs: Long,
    )

    fun beforeSend(paused: Boolean, insertedNew: Boolean, c: Candidate, nowElapsedMs: Long): Decision {
        if (paused) return Decision.StopBatch
        if (!insertedNew) return Decision.Skip("duplicate-local")
        if (c.requiresSendAuth) {
            val budget = c.sendWithinMs ?: return Decision.Fail("no-deadline")
            if (nowElapsedMs - c.receivedAtElapsedMs >= budget) return Decision.Fail("expired-on-device")
            return Decision.NeedsAuthorization
        }
        return Decision.Send
    }

    /**
     * Interpret the authorization answer. [ok] null = the call failed (network,
     * timeout, server error) → fail closed. Re-checks pause and the deadline,
     * because the round trip took time.
     */
    fun afterAuthorization(
        ok: Boolean?, reason: String?, paused: Boolean, c: Candidate, nowElapsedMs: Long,
    ): Decision {
        if (ok == null) return Decision.Fail("auth-unavailable")
        if (!ok) return Decision.Skip("not-authorized:${reason ?: "unknown"}") // server already settled the job
        if (paused) return Decision.Fail("paused-after-auth")
        val budget = c.sendWithinMs ?: return Decision.Fail("no-deadline")
        if (nowElapsedMs - c.receivedAtElapsedMs >= budget) return Decision.Fail("expired-on-device")
        return Decision.Send
    }
}
