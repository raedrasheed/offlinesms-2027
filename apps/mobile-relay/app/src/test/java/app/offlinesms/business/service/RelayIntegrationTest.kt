package app.offlinesms.business.service

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.offlinesms.business.data.db.JobDao
import app.offlinesms.business.data.db.RelayDb
import app.offlinesms.business.net.Callables
import app.offlinesms.business.net.ClaimedJob
import app.offlinesms.business.net.RelayApi
import app.offlinesms.business.net.parseClaimedJobs
import app.offlinesms.business.net.parseSendAuthorization
import app.offlinesms.business.service.SendPipeline.Outcome
import app.offlinesms.business.sms.SendResultAggregator
import app.offlinesms.business.work.FlushResult
import app.offlinesms.business.work.ReportStore
import app.offlinesms.business.work.flushReports
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException

/**
 * Layer: the relay app's production send AND report path under Robolectric —
 * [relayPipeline] (RelayApiBackend + RoomLocalJobs + SendPipeline), the
 * production report persistence ([ReportStore], awaited by the pipeline via
 * [StoreReports]) and flush ([flushReports] → [RelayApi.report]), on a real
 * file-backed Room v3 database (closed and reopened to simulate a process
 * restart), with a FAKE callable transport (an in-memory server that binds
 * reports to attempts like reportRelayDelivery, and can go offline or lose a
 * response after committing) and a fake SMS transport counting hand-offs.
 * SMS callbacks are driven through the production [SendResultAggregator] +
 * [ReportStore], i.e. what SmsResultReceiver does minus the Android broadcast
 * glue. Not covered here: the RelayService lifecycle, WorkManager scheduling,
 * SmsManager/modem/carrier, device timing.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class RelayIntegrationTest {
    private val ctx get() = ApplicationProvider.getApplicationContext<Context>()
    private val dbName = "relay-it.db"
    private lateinit var db: RelayDb
    private val server = FakeServer()
    private val handoffs = mutableListOf<String>()
    private var now = 0L
    private var paused = false
    private var onDurableSending: () -> Unit = {}
    /** Q2 seams, inside the production code path: right after admission reads the
     *  row (before it writes), and around the conditional 'sending' write. */
    private var afterRowRead: suspend (String) -> Unit = {}
    private var beforeBeginSending: suspend (String) -> Unit = {}
    private var afterBeginSending: suspend (String) -> Unit = {}
    private val originalCallables = RelayApi.callables

    @Before fun setUp() {
        ctx.deleteDatabase(dbName)
        db = open()
        RelayApi.callables = server
    }

    @After fun tearDown() { RelayApi.callables = originalCallables; db.close(); ctx.deleteDatabase(dbName) }

    private fun open(): RelayDb = Room.databaseBuilder(ctx, RelayDb::class.java, dbName)
        .addMigrations(*RelayDb.MIGRATIONS).allowMainThreadQueries().build()

    /** Process restart: everything in memory is gone; only the database file survives. */
    private fun restart() { db.close(); db = open() }

    private fun pipeline(): SendPipeline {
        val dao = db.jobs()
        return relayPipeline(
            deviceId = "dev-1",
            db = db,
            dao = object : JobDao by dao {
                override suspend fun byId(jobId: String) = dao.byId(jobId).also { afterRowRead(jobId) }
                override suspend fun beginSending(jobId: String, attempt: Int, now: Long): Int {
                    beforeBeginSending(jobId)
                    val n = dao.beginSending(jobId, attempt, now)
                    if (n == 1) onDurableSending()
                    afterBeginSending(jobId)
                    return n
                }
            },
            transport = object : SendPipeline.Transport { override fun send(job: ClaimedJob) { handoffs += "${job.jobId}#${job.attempt}" } },
            reports = StoreReports(ReportStore(db) { now }),
            clock = object : SendPipeline.Clock { override fun elapsedMs() = now },
            pause = object : SendPipeline.Pause { override val paused get() = this@RelayIntegrationTest.paused },
            pacer = {},
        )
    }
    private fun run() = runBlocking { pipeline().runOnce(5) }
    private fun row(id: String) = runBlocking { db.jobs().byId(id) }
    private fun pending() = runBlocking { db.reports().batch() }
    private fun flush(): FlushResult = runBlocking {
        flushReports(db.reports(),
            send = { RelayApi.report("dev-1", it.jobId, it.attempt, it.status, it.reason, it.androidResultCode, it.simSubscriptionId) },
            isPermanent = { it is PermanentRefusal })
    }
    /** What SmsResultReceiver does for one part callback (minus the broadcast glue). */
    private fun callback(jobId: String, attempt: Int?, kind: SendResultAggregator.Kind, total: Int, ok: Boolean) = runBlocking {
        aggregator.onPart(jobId, attempt, kind, total, ok)?.let {
            ReportStore(db) { now }.record(jobId, attempt, it.status, it.reason, if (ok) -1 else 4, it.noResend)
        }
    }
    private val aggregator = SendResultAggregator()

    class PermanentRefusal(msg: String) : Exception(msg)

    /** In-memory stand-in for claimRelayJobs / authorizeRelaySend / reportRelayDelivery (wire shapes and attempt binding). */
    private class FakeServer : Callables {
        data class Job(val id: String, val kind: String?, var status: String = "queued", var attempt: Int = 0,
                       var remainingMs: Long = 60_000, var noRetry: Boolean = false, val maxAttempts: Int = 5)
        val jobs = linkedMapOf<String, Job>()
        val calls = mutableListOf<String>()
        var authorize: (Job) -> Map<String, Any?>? = { mapOf("ok" to true, "sendWithinMs" to 15_000L) }
        val received = mutableListOf<Map<String, Any?>>()   // every report that reached the server
        var online = true
        var loseNextAck = false

        fun add(id: String, kind: String?) { jobs[id] = Job(id, kind) }
        /** Lease lapsed / pre-hand-off pause handled server-side: next claim is a new attempt. */
        fun requeue(id: String) { jobs.getValue(id).let { if (!it.noRetry && it.status in setOf("claimed", "sending")) it.status = "queued" } }

        override suspend fun call(name: String, data: Map<String, Any?>): Any? {
            calls += name
            return when (name) {
                "claimRelayJobs" -> {
                    @Suppress("UNCHECKED_CAST")
                    val caps = data["clientCaps"] as List<String>
                    assertTrue(caps.containsAll(listOf("send-auth-v1", "attempt-v1")))
                    val out = jobs.values.filter { it.status == "queued" }.map { j ->
                        j.status = "claimed"; j.attempt++
                        val otp = j.kind != null
                        mapOf("jobId" to j.id, "phoneE164" to "+970599100001", "messageBody" to "body ${j.id}",
                            "assignedSimSubscriptionId" to null, "traceId" to j.id, "kind" to j.kind,
                            "requiresSendAuth" to otp, "sendWithinMs" to (if (otp) j.remainingMs else null), "attempt" to j.attempt)
                    }
                    mapOf("jobs" to out, "capacityExhausted" to null)
                }
                "authorizeRelaySend" -> authorize(jobs.getValue(data["jobId"] as String)) ?: throw IOException("UNAVAILABLE")
                "reportRelayDelivery" -> {
                    if (!online) throw IOException("offline")
                    received += data
                    val j = jobs[data["jobId"] as String] ?: throw PermanentRefusal("job-not-found")
                    val a = data["attempt"] as Int?
                    val bound = if (a == null) j.attempt <= 1 else a == j.attempt
                    val result: Map<String, Any?> = if (!bound) {
                        mapOf("ok" to true, "applied" to false, "notApplied" to if (a == null) "unbound" else "stale")
                    } else {
                        val reason = data["reason"] as String?
                        when (data["status"]) {
                            "sent", "delivered" -> { j.status = data["status"] as String; j.noRetry = true }
                            "failed" -> j.status = when {
                                reason?.startsWith("ambiguous") == true -> "failed"
                                j.noRetry || j.attempt >= j.maxAttempts -> "failed"
                                else -> "queued"
                            }
                        }
                        mapOf("ok" to true, "applied" to true)
                    }
                    if (loseNextAck) { loseNextAck = false; throw IOException("response lost") } // committed above
                    result
                }
                else -> mapOf<String, Any?>()
            }
        }
    }

    // ── M1: the no-resend decision survives an offline report, lease expiries and a restart ──
    @Test fun m1_ambiguousJob_neverHandedOffTwice_acrossReportOutage_twoLeaseExpiries_andRestart() {
        server.add("b1", null)
        run()                                              // attempt 1 handed off; no callback ever arrives
        assertEquals(listOf("b1#1"), handoffs)
        server.online = false                              // reports can't reach the server
        server.requeue("b1")                               // lease 1 lapsed
        assertEquals(Outcome.Failed("b1", "ambiguous-handoff"), run().single())
        assertTrue(row("b1")!!.noResend)                   // durable before anything else
        assertEquals(1, flush().kept)                      // the ambiguous report is held offline
        server.requeue("b1")                               // lease 2 lapsed too
        restart()                                          // process death
        assertEquals(Outcome.Failed("b1", "ambiguous-handoff"), run().single()) // attempt 3
        assertEquals(listOf("b1#1"), handoffs)             // still exactly ONE hand-off
        val r = row("b1")!!
        assertEquals(1, r.attempt); assertEquals("sending", r.localStatus); assertTrue(r.noResend)
        assertEquals(listOf(2, 3), pending().map { it.attempt })

        // Network back: both reports flush; the stale one (attempt 2) is acknowledged
        // without being applied, the current one (attempt 3) ends the job.
        server.online = true
        assertEquals(FlushResult(delivered = 2, dropped = 0, kept = 0), flush())
        assertEquals(listOf(2, 3), server.received.map { it["attempt"] })
        assertEquals("failed", server.jobs.getValue("b1").status)
        assertTrue(pending().isEmpty())
        server.requeue("b1"); run()
        assertEquals(listOf("b1#1"), handoffs)
    }

    @Test fun m1_positiveControl_knownPreHandOffPause_isRetriedOnceAsTheNextAttempt() {
        server.add("b2", null)
        onDurableSending = { paused = true }               // pause lands during the durable write
        assertTrue(run().single() is Outcome.StoppedBatch)
        assertTrue(handoffs.isEmpty())
        assertEquals("paused", row("b2")!!.localStatus)
        assertNull(row("b2")!!.body)                       // body dropped for the stopped attempt
        paused = false; onDurableSending = {}
        server.requeue("b2")
        run()
        assertEquals(listOf("b2#2"), handoffs)
        assertEquals(2, row("b2")!!.attempt)
    }

    @Test fun m1_positiveControl_definitiveCarrierFailure_isRetried_partialSendIsNot() {
        server.add("b3", null); server.add("b4", null)
        run()
        assertEquals(listOf("b3#1", "b4#1"), handoffs)
        // b3: every part rejected by the radio → nothing went out → retry allowed.
        callback("b3", 1, SendResultAggregator.Kind.SENT, 2, ok = false)
        callback("b3", 1, SendResultAggregator.Kind.SENT, 2, ok = false)
        // b4: one part out, one rejected → partially sent → never resent.
        callback("b4", 1, SendResultAggregator.Kind.SENT, 2, ok = true)
        callback("b4", 1, SendResultAggregator.Kind.SENT, 2, ok = false)
        assertEquals(listOf("carrier-send-failed", "ambiguous-partial-send"), pending().map { it.reason })
        flush()
        assertEquals("queued", server.jobs.getValue("b3").status)
        assertEquals("failed", server.jobs.getValue("b4").status)
        server.jobs.getValue("b4").status = "queued" // even if a server re-queued it, this device refuses it
        run()
        assertEquals(listOf("b3#1", "b4#1", "b3#2"), handoffs)
    }

    // ── M2: attempt identity through callbacks, reports and local status ──
    @Test fun m2_lostAcknowledgment_oldReportRetriedDuringAttempt2_onTheSameDevice_changesNothing() {
        server.add("b5", null)
        run()
        callback("b5", 1, SendResultAggregator.Kind.SENT, 1, ok = false)   // definitive failure, attempt 1
        server.loseNextAck = true
        assertEquals(1, flush().kept)                     // server committed the requeue; the device never heard
        assertEquals("queued", server.jobs.getValue("b5").status)
        run()                                              // attempt 2 on the SAME device
        assertEquals(listOf("b5#1", "b5#2"), handoffs)
        assertEquals(2, server.jobs.getValue("b5").attempt)
        flush()                                            // the unchanged attempt-1 report is retried
        assertEquals(listOf(1, 1), server.received.map { it["attempt"] })
        assertEquals("claimed", server.jobs.getValue("b5").status) // attempt 2 untouched
        val r = row("b5")!!
        assertEquals(2, r.attempt); assertEquals("sending", r.localStatus); assertEquals("body b5", r.body)
        assertTrue(pending().isEmpty())
        callback("b5", 2, SendResultAggregator.Kind.SENT, 1, ok = true); flush()
        assertEquals("sent", server.jobs.getValue("b5").status)
    }

    @Test fun m2_delayedCallbackForAnOlderAttempt_neverRewritesTheNewerRow_andMultipartProgressNeverMixes() {
        server.add("b6", null)
        run()                                              // attempt 1: 2 parts
        callback("b6", 1, SendResultAggregator.Kind.SENT, 2, ok = false)   // part 1 of attempt 1 failed …
        // … attempt 1 is settled as retryable by the server some other way, attempt 2 starts (also 2 parts)
        runBlocking { ReportStore(db) { now }.record("b6", 1, "failed", "lease-lost", null) }
        server.requeue("b6"); run()
        assertEquals(listOf("b6#1", "b6#2"), handoffs)
        callback("b6", 2, SendResultAggregator.Kind.SENT, 2, ok = true)    // part 1 of attempt 2 OK
        callback("b6", 1, SendResultAggregator.Kind.SENT, 2, ok = false)   // LATE part 2 of attempt 1
        // Attempt 1 completes on its own (all parts failed); attempt 2 is still waiting for its part 2.
        val r = row("b6")!!
        assertEquals(2, r.attempt); assertEquals("sending", r.localStatus); assertEquals("body b6", r.body)
        assertEquals(listOf(1, 1), pending().map { it.attempt })
        callback("b6", 2, SendResultAggregator.Kind.SENT, 2, ok = true)    // part 2 of attempt 2
        assertEquals("sent", row("b6")!!.localStatus)
        assertEquals(listOf(1, 1, 2), pending().map { it.attempt })
    }

    // ── Q2: the no-resend mark is never lost to a concurrent local writer ──
    /** b: attempt 1 went out and its SENT callback said every part failed (retryable). */
    private fun retryableFirstAttempt(id: String) {
        server.add(id, null)
        run()
        callback(id, 1, SendResultAggregator.Kind.SENT, 1, ok = false)
        assertTrue(!row(id)!!.noResend)
        server.jobs.getValue(id).status = "queued" // the server re-queued it after that report
    }
    /**
     * A delayed report that attempt 1 may have gone out after all (e.g. a late
     * delivery receipt), written by the production ReportStore. Called from the
     * seams on the pipeline's own coroutine. Inside admission it is a NESTED
     * write within the admission transaction (it joins it; it does not commit
     * independently): with admission atomic, that is the only way any write can
     * land between admission's read and its takeover. A writer on another
     * coroutine waits for the transaction's lock and lands after it — the
     * before/after-sending-decision tests cover those orderings.
     */
    private suspend fun lateReport(id: String) {
        ReportStore(db) { now }.record(id, 1, "delivered", null, -1)
    }

    @Test fun q2_nestedReportWriteBetweenAdmissionReadAndTakeover_isPreserved_andTheAttemptIsRefused() {
        retryableFirstAttempt("q1")
        var fired = false
        afterRowRead = { id -> if (id == "q1" && !fired) { fired = true; lateReport(id) } }
        assertEquals(Outcome.Failed("q1", "ambiguous-handoff"), run().single()) // attempt 2
        assertEquals(listOf("q1#1"), handoffs)            // attempt 2 never reached the transport
        val r = row("q1")!!
        assertTrue(r.noResend); assertEquals(1, r.attempt)
        afterRowRead = {}
        restart()
        server.jobs.getValue("q1").status = "queued"      // even if offered again (attempt 3)…
        run()
        assertEquals(listOf("q1#1"), handoffs)            // …refused after reopening Room
        assertTrue(row("q1")!!.noResend)
    }

    @Test fun q2_reportAfterAdmission_beforeTheSendingWrite_blocksTheHandOff() {
        retryableFirstAttempt("q2")
        beforeBeginSending = { id -> if (id == "q2") lateReport(id) }
        assertEquals(Outcome.Failed("q2", "ambiguous-handoff"), run().single())
        assertEquals(listOf("q2#1"), handoffs)
        val r = row("q2")!!
        assertTrue(r.noResend); assertEquals(2, r.attempt); assertEquals("failed", r.localStatus)
    }

    @Test fun q2_reportAfterTheLocalSendingDecision_keepsTheGuard_andRefusesEveryLaterAttempt() {
        retryableFirstAttempt("q3")
        // The report lands after the committed 'sending' decision but BEFORE
        // transport.send: the in-flight attempt still proceeds to the (fake)
        // transport; the mark stays effective for every later attempt.
        afterBeginSending = { id -> if (id == "q3") lateReport(id) }
        run()
        assertEquals(listOf("q3#1", "q3#2"), handoffs)
        assertTrue(row("q3")!!.noResend)
        afterBeginSending = {}
        restart()
        server.jobs.getValue("q3").status = "queued"
        run()
        assertEquals(listOf("q3#1", "q3#2"), handoffs)
        assertTrue(row("q3")!!.noResend)
    }

    @Test fun q2_positiveControl_withoutAnyLateReport_theRetryableAttemptIsSentOnce() {
        retryableFirstAttempt("q4")
        run()
        assertEquals(listOf("q4#1", "q4#2"), handoffs)
        assertEquals(2, row("q4")!!.attempt)
    }

    // ── report flushing ──
    @Test fun flush_permanentRefusalIsDropped_transientIsKept_andNothingBlocksTheQueue() {
        server.add("b7", null)
        runBlocking {
            val store = ReportStore(db) { now }
            store.record("ghost", 1, "failed", "x", null)  // server: job-not-found → permanent
            store.record("b7", 1, "sent", null, -1)
        }
        server.jobs.getValue("b7").apply { status = "claimed"; attempt = 1 }
        assertEquals(FlushResult(delivered = 1, dropped = 1, kept = 0), flush())
        assertEquals("sent", server.jobs.getValue("b7").status)
        assertTrue(pending().isEmpty())
    }

    // ── verification codes (send-auth path) ──
    @Test fun verificationCode_authorizedOnce_durableRowBeforeHandOff_neverResent() {
        server.add("pauth_a", "phone_auth_otp")
        var rowAtHandOff: String? = null
        onDurableSending = { rowAtHandOff = row("pauth_a")?.localStatus }
        assertEquals(listOf(Outcome.Sent("pauth_a")), run())
        assertEquals(listOf("pauth_a#1"), handoffs)
        assertEquals("sending", rowAtHandOff)
        assertEquals(listOf("claimRelayJobs", "authorizeRelaySend"), server.calls)
        assertEquals("•••01", row("pauth_a")!!.phoneE164) // only a masked number is stored locally
        server.requeue("pauth_a"); server.jobs.getValue("pauth_a").attempt-- // same attempt handed out again
        run()
        assertEquals(listOf("pauth_a#1"), handoffs)
    }

    @Test fun verificationCode_authorizationUnavailable_failsClosed() {
        server.add("pauth_b", "phone_auth_otp")
        server.authorize = { null }
        run()
        assertTrue(handoffs.isEmpty())
        assertEquals("auth-unavailable", pending().single().reason)
    }

    @Test fun verificationCode_refusedAtAuthorization_isSkipped_andItsCodeIsDropped() {
        server.add("pauth_c", "phone_auth_otp")
        server.authorize = { mapOf("ok" to false, "reason" to "country-not-allowed") }
        assertEquals(Outcome.Skipped("pauth_c", "not-authorized:country-not-allowed"), run().single())
        assertTrue(handoffs.isEmpty())
        assertEquals("skipped", row("pauth_c")!!.localStatus)
        assertNull(row("pauth_c")!!.body)
    }

    @Test fun verificationCode_staleAuthorization_isNotSent() {
        server.add("pauth_d", "phone_auth_otp")
        server.authorize = { now += 3_000; mapOf("ok" to true, "sendWithinMs" to 1_000L) }
        run()
        assertTrue(handoffs.isEmpty())
        assertEquals("expired-on-device", pending().single().reason)
    }

    @Test fun contractFixtures_parseToTheExpectedJobs() {
        val claim = parseClaimedJobs(fixture("claim-response.json"))
        assertEquals(2, claim.size)
        assertEquals(ClaimedJob("pauth_0123456789abcdef0123456789abcdef", "+970599100001", "Your OfflineSMS code is 000000",
            2, "pauth_0123456789abcdef0123456789abcdef", "phone_auth_otp", true, 9_500, 1), claim[0])
        assertEquals(ClaimedJob("b1", "+970599100002", "hello", null, "b1", null, false, null, 2), claim[1])
        val auth = parseSendAuthorization(fixture("authorize-response.json"))
        assertTrue(auth.ok); assertEquals(15_000L, auth.sendWithinMs); assertNull(auth.reason)
        assertTrue(!parseSendAuthorization("garbage").ok)
    }

    // ── migrations (non-destructive) ──
    private fun v1Schema(d: SQLiteDatabase) {
        d.execSQL("CREATE TABLE IF NOT EXISTS `jobs` (`jobId` TEXT NOT NULL, `phoneE164` TEXT NOT NULL, `body` TEXT, `simSubscriptionId` INTEGER, `traceId` TEXT NOT NULL, `localStatus` TEXT NOT NULL, `createdAt` INTEGER NOT NULL, `updatedAt` INTEGER NOT NULL, PRIMARY KEY(`jobId`))")
        d.execSQL("CREATE TABLE IF NOT EXISTS `reports` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `jobId` TEXT NOT NULL, `status` TEXT NOT NULL, `reason` TEXT, `androidResultCode` INTEGER, `simSubscriptionId` INTEGER, `createdAt` INTEGER NOT NULL)")
        d.execSQL("CREATE TABLE IF NOT EXISTS `logs` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `at` INTEGER NOT NULL, `level` TEXT NOT NULL, `event` TEXT NOT NULL, `detail` TEXT)")
    }
    private fun legacyFile(version: Int, rows: (SQLiteDatabase) -> Unit) {
        db.close(); ctx.deleteDatabase(dbName)
        SQLiteDatabase.openOrCreateDatabase(ctx.getDatabasePath(dbName).apply { parentFile?.mkdirs() }, null).use { d ->
            v1Schema(d)
            if (version >= 2) d.execSQL("ALTER TABLE jobs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0")
            rows(d)
            d.version = version
        }
        db = open()
    }

    @Test fun roomMigration_1to3_keepsJobsAndPendingReports() {
        legacyFile(1) { d ->
            d.execSQL("INSERT INTO jobs VALUES ('old-1', '•••01', NULL, NULL, 'old-1', 'sending', 1, 1)")
            d.execSQL("INSERT INTO reports (jobId, status, reason, androidResultCode, simSubscriptionId, createdAt) VALUES ('old-1', 'sent', NULL, -1, NULL, 1)")
        }
        val old = row("old-1")!!
        assertEquals(0, old.attempt); assertEquals("sending", old.localStatus); assertTrue(old.noResend)
        assertNull(pending().single().attempt)
    }

    @Test fun roomMigration_2to3_marksPossiblyHandedOffJobs_keepsPendingReportsUnbound() {
        legacyFile(2) { d ->
            d.execSQL("INSERT INTO jobs VALUES ('s', '•••01', NULL, NULL, 's', 'sending', 1, 1, 1)")
            d.execSQL("INSERT INTO jobs VALUES ('f', '•••02', NULL, NULL, 'f', 'failed', 1, 1, 1)")
            d.execSQL("INSERT INTO jobs VALUES ('d', '•••03', NULL, NULL, 'd', 'delivered', 1, 1, 2)")
            d.execSQL("INSERT INTO reports (jobId, status, reason, androidResultCode, simSubscriptionId, createdAt) VALUES ('s', 'failed', 'no-service', 4, NULL, 1)")
        }
        assertTrue(row("s")!!.noResend); assertTrue(!row("f")!!.noResend); assertTrue(row("d")!!.noResend)
        val p = pending().single()
        assertEquals("s", p.jobId); assertNull(p.attempt)          // data kept, never guessed
        // Flushed unbound: the server applies it only to a never-re-leased job.
        server.add("s", null); server.jobs.getValue("s").apply { status = "claimed"; attempt = 2 }
        flush()
        assertTrue(server.received.single().containsKey("attempt"))
        assertNull(server.received.single()["attempt"])
        assertEquals("claimed", server.jobs.getValue("s").status)
        // and this device never re-sends the possibly-handed-off job
        server.requeue("s"); run()
        assertTrue(handoffs.isEmpty())
    }

    private fun fixture(file: String): Any? {
        val text = javaClass.classLoader!!.getResource("relay-contract/$file")!!.readText()
        return toKotlin(JSONObject(text))
    }
    private fun toKotlin(v: Any?): Any? = when (v) {
        is JSONObject -> v.keys().asSequence().associateWith { toKotlin(v.get(it)) }
        is JSONArray -> (0 until v.length()).map { toKotlin(v.get(it)) }
        JSONObject.NULL -> null
        else -> v
    }
}
