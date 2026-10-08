package app.offlinesms.business.service

import app.offlinesms.business.net.ClaimedJob
import app.offlinesms.business.net.SendAuthorization
import app.offlinesms.business.service.SendPipeline.Outcome
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Layer: Android-free pipeline with fakes (backend, local job store standing in
 * for Room, SMS transport standing in for SmsManager, monotonic clock). Room and
 * the real network are exercised by the full Android build + device runs, not here.
 */
class SendPipelineTest {
    private class Fake {
        var now = 0L
        var paused = false
        val sent = mutableListOf<String>()
        val failed = mutableListOf<Pair<String, String>>()
        val rows = linkedMapOf<String, SendPipeline.LocalJob>()
        var claimQueue = ArrayDeque<List<ClaimedJob>>()
        var claimLatencyMs = 0L
        var authLatencyMs = 0L
        var authAnswer: (String) -> SendAuthorization? = { SendAuthorization(true, null, 60_000) }
        var onSetStatus: (String) -> Unit = {}
        var throwOnSend = false

        val pipeline = SendPipeline(
            backend = object : SendPipeline.Backend {
                override suspend fun claim(capacity: Int): List<ClaimedJob> {
                    val jobs = claimQueue.removeFirstOrNull() ?: emptyList(); now += claimLatencyMs; return jobs
                }
                override suspend fun authorize(jobId: String): SendAuthorization {
                    val a = authAnswer(jobId); now += authLatencyMs
                    return a ?: throw RuntimeException("network down")
                }
            },
            local = object : SendPipeline.LocalJobs {
                // Mirrors RoomLocalJobs: decision on the current row, then a write that keeps noResend.
                override suspend fun admit(job: ClaimedJob): String? {
                    val r = rows[job.jobId]
                    SendPipeline.dedup(r, job)?.let { return it }
                    if (r?.noResend == true) return "ambiguous-handoff"
                    rows[job.jobId] = SendPipeline.LocalJob(job.jobId, job.attempt, "claimed", r?.noResend ?: false)
                    return null
                }
                override suspend fun beginSending(jobId: String, attempt: Int): Boolean {
                    val r = rows.getValue(jobId)
                    if (r.attempt != attempt || r.noResend) return false
                    rows[jobId] = r.copy(localStatus = "sending"); onSetStatus("sending")
                    return true
                }
                override suspend fun setStatus(jobId: String, attempt: Int, localStatus: String) {
                    val r = rows.getValue(jobId)
                    if (r.attempt == attempt) rows[jobId] = r.copy(localStatus = localStatus) // attempt-bound, like JobDao
                    onSetStatus(localStatus)
                }
            },
            transport = object : SendPipeline.Transport {
                override fun send(job: ClaimedJob) {
                    if (throwOnSend) throw IllegalStateException("radio")
                    sent += "${job.jobId}#${job.attempt}"
                }
            },
            reports = object : SendPipeline.Reports {
                // Mirrors ReportStore: sticky noResend, then an attempt-bound finalize.
                override suspend fun failed(jobId: String, attempt: Int, reason: String, noResend: Boolean) {
                    failed += jobId to reason
                    rows[jobId]?.let { r ->
                        var n = if (noResend) r.copy(noResend = true) else r
                        if (n.attempt == attempt) n = n.copy(localStatus = "failed")
                        rows[jobId] = n
                    }
                }
            },
            clock = object : SendPipeline.Clock { override fun elapsedMs() = now },
            pause = object : SendPipeline.Pause { override val paused get() = this@Fake.paused },
        )
        fun run(vararg jobs: ClaimedJob) = runBlocking { claimQueue.addLast(jobs.toList()); pipeline.runOnce(10) }
    }

    private fun otp(id: String = "pauth_1", within: Long = 10_000, attempt: Int = 1) =
        ClaimedJob(id, "+970599100001", "code", null, id, "phone_auth_otp", true, within, attempt)
    private fun biz(id: String = "b:1", attempt: Int = 1) = ClaimedJob(id, "+970599100002", "hi", null, id, null, false, null, attempt)

    // ── N4: deadlines ──────────────────────────────────────────────────────
    @Test fun reviewTimingSequence_t0_t8_t9_t12_isNotSent() {
        // Server: 10 s left at t=0; claim response arrives t=8; authorization
        // validated at t=9 (≈1 s left), its response arrives t=12.
        val f = Fake()
        f.claimLatencyMs = 8_000
        f.authLatencyMs = 3_000
        f.authAnswer = { SendAuthorization(true, null, 1_000) }
        f.now = 0
        val out = f.run(otp(within = 10_000))
        assertTrue(f.sent.isEmpty())
        assertTrue(out.single() is Outcome.Failed)
        assertEquals("expired-on-device", (out.single() as Outcome.Failed).reason)
    }

    @Test fun claimLatencyShortensNeverExtendsTheBudget() {
        val f = Fake()
        f.claimLatencyMs = 9_000 // budget 10 s from REQUEST start, minus margin → past deadline already
        val out = f.run(otp(within = 10_000))
        assertEquals("expired-on-device", (out.single() as Outcome.Failed).reason)
        assertTrue(f.sent.isEmpty())
    }

    @Test fun staleAuthorizationIsNotUsable() {
        val f = Fake()
        f.authAnswer = { SendAuthorization(true, null, 2_000) } // short-lived "ok"
        f.authLatencyMs = 2_500
        f.run(otp(within = 60_000))
        assertTrue(f.sent.isEmpty())
        assertEquals("expired-on-device", f.failed.single().second)
    }

    @Test fun freshAuthorizationSendsOnce() {
        val f = Fake()
        f.claimLatencyMs = 300; f.authLatencyMs = 300
        f.run(otp(within = 60_000))
        assertEquals(listOf("pauth_1#1"), f.sent)
    }

    @Test fun networkLossAtAuthorizationFailsClosed() {
        val f = Fake()
        f.authAnswer = { null }
        f.run(otp())
        assertTrue(f.sent.isEmpty())
        assertEquals("auth-unavailable", f.failed.single().second)
    }

    @Test fun refusedAuthorizationIsNotSent() {
        val f = Fake()
        f.authAnswer = { SendAuthorization(false, "sending-stopped", null) }
        val out = f.run(otp())
        assertTrue(f.sent.isEmpty())
        assertTrue((out.single() as Outcome.Skipped).reason.contains("sending-stopped"))
    }

    @Test fun pauseDuringTheDurableWriteStopsTheHandOff() {
        val f = Fake()
        f.onSetStatus = { if (it == "sending") f.paused = true }
        f.run(otp(within = 60_000))
        assertTrue(f.sent.isEmpty())
        assertEquals("paused-after-auth", f.failed.single().second)
        // Business job: no hand-off, local row returns to 'paused', batch stops.
        val g = Fake()
        g.onSetStatus = { if (it == "sending") g.paused = true }
        val out = g.run(biz("b:1"), biz("b:2"))
        assertTrue(g.sent.isEmpty())
        assertEquals("paused", g.rows["b:1"]!!.localStatus)
        assertEquals(1, out.size)
    }

    @Test fun wallClockSkewIsIrrelevantOnlyMonotonicTimeCounts() {
        // The pipeline never reads wall time; a large monotonic jump past the
        // deadline (e.g. app backgrounded) still blocks the send.
        val f = Fake()
        f.authAnswer = { f.now += 120_000; SendAuthorization(true, null, 60_000) }
        f.run(otp(within = 60_000))
        assertTrue(f.sent.isEmpty())
    }

    // ── N5: attempt-aware de-duplication ─────────────────────────────────
    @Test fun sameAttemptDeliveredTwiceIsSentOnce() {
        val f = Fake()
        f.run(biz("b:1", 1))
        f.run(biz("b:1", 1))
        assertEquals(listOf("b:1#1"), f.sent)
    }

    @Test fun businessRetryAfterPreHandoffPauseCompletesOnce() {
        val f = Fake()
        // Paused after the claim, right at the durable write: no hand-off.
        f.onSetStatus = { if (it == "sending") f.paused = true }
        f.run(biz("b:1", 1))
        assertTrue(f.sent.isEmpty())
        assertEquals("paused", f.rows["b:1"]!!.localStatus)
        // Resume; the lease lapsed and the server re-queued the job as attempt 2.
        f.onSetStatus = {}
        f.paused = false
        f.run(biz("b:1", 2))
        f.run(biz("b:1", 2)) // duplicate delivery of attempt 2
        assertEquals(listOf("b:1#2"), f.sent)
    }

    @Test fun businessRetryAfterTransientCarrierFailureIsAllowed() {
        val f = Fake()
        f.run(biz("b:1", 1))
        f.rows["b:1"] = f.rows["b:1"]!!.copy(localStatus = "failed") // SmsResultReceiver reported failed
        f.run(biz("b:1", 2))
        assertEquals(listOf("b:1#1", "b:1#2"), f.sent)
    }

    @Test fun ambiguousHandOffIsNeverRetried() {
        val f = Fake()
        f.run(biz("b:1", 1))
        // Crash after hand-off: row left in 'sending', no result.
        f.rows["b:1"] = f.rows["b:1"]!!.copy(localStatus = "sending")
        f.run(biz("b:1", 2))
        assertEquals(listOf("b:1#1"), f.sent)
        assertEquals("b:1" to "ambiguous-handoff", f.failed.single())
    }

    // ── M1: the ambiguity decision survives its own report ──────────────────
    @Test fun thirdAttemptAfterAnAmbiguousSecondIsNeverSent() {
        val f = Fake()
        f.run(biz("b:m1", attempt = 1))                   // handed off; no definitive result
        assertEquals(listOf("b:m1#1"), f.sent)
        f.run(biz("b:m1", attempt = 2))                   // refused as ambiguous
        assertEquals("ambiguous-handoff", f.failed.single().second)
        // The report's own finalize must not make the job retryable again.
        f.rows["b:m1"] = f.rows.getValue("b:m1").copy(localStatus = "failed")
        f.run(biz("b:m1", attempt = 3))
        assertEquals(listOf("b:m1#1"), f.sent)            // still exactly one hand-off
        assertTrue(f.rows.getValue("b:m1").noResend)
    }

    @Test fun sendCallFailureIsAmbiguousNeverRetried() {
        val f = Fake()
        f.throwOnSend = true
        f.run(biz("b:x", attempt = 1))
        assertEquals("ambiguous-send-exception", f.failed.single().second)
        f.throwOnSend = false
        f.run(biz("b:x", attempt = 2))
        assertTrue(f.sent.isEmpty())
    }

    @Test fun verificationCodesAreNeverSentTwice() {
        val f = Fake()
        f.run(otp(attempt = 1, within = 60_000))
        f.rows["pauth_1"] = f.rows["pauth_1"]!!.copy(localStatus = "failed")
        f.run(otp(attempt = 2, within = 60_000))
        assertEquals(listOf("pauth_1#1"), f.sent)
    }

    @Test fun localPauseIsCheckedBeforeEveryJob() {
        val f = Fake()
        var n = 0
        f.authAnswer = { if (++n == 1) f.paused = true; SendAuthorization(true, null, 60_000) }
        f.run(otp("pauth_a", 60_000), otp("pauth_b", 60_000))
        assertTrue(f.sent.isEmpty())
    }
}
