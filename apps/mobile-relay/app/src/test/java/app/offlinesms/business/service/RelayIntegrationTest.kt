package app.offlinesms.business.service

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.offlinesms.business.data.db.RelayDb
import app.offlinesms.business.net.Callables
import app.offlinesms.business.net.ClaimedJob
import app.offlinesms.business.net.RelayApi
import app.offlinesms.business.net.parseClaimedJobs
import app.offlinesms.business.net.parseSendAuthorization
import app.offlinesms.business.service.SendPipeline.Outcome
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

/**
 * Layer: the relay app's production send wiring — [relayPipeline] with the real
 * Room database (schema v2, in-memory) and the real [RelayApi] request/response
 * code — driven through a FAKE callable transport (an in-memory server) and a
 * fake SMS transport, under Robolectric. Not covered here: the RelayService
 * lifecycle (foreground start, FCM wake, Firebase sign-in), SmsManager itself,
 * carrier behaviour, and real-device timing.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class RelayIntegrationTest {
    private lateinit var db: RelayDb
    private val server = FakeServer()
    private val sent = mutableListOf<String>()
    private val failed = mutableListOf<Pair<String, String>>()
    private var now = 0L
    private var paused = false
    private var onDurableSending: () -> Unit = {}
    private val originalCallables = RelayApi.callables

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), RelayDb::class.java)
            .allowMainThreadQueries().build()
        RelayApi.callables = server
    }

    @After fun tearDown() { RelayApi.callables = originalCallables; db.close() }

    private fun pipeline(): SendPipeline {
        val dao = db.jobs()
        return relayPipeline(
            deviceId = "dev-1",
            dao = object : app.offlinesms.business.data.db.JobDao by dao {
                override suspend fun setStatus(jobId: String, status: String, now: Long) {
                    dao.setStatus(jobId, status, now); if (status == "sending") onDurableSending()
                }
            },
            transport = object : SendPipeline.Transport { override fun send(job: ClaimedJob) { sent += "${job.jobId}#${job.attempt}" } },
            reports = object : SendPipeline.Reports {
                override fun failed(jobId: String, reason: String) {
                    failed += jobId to reason
                    server.report(jobId, reason)
                }
            },
            clock = object : SendPipeline.Clock { override fun elapsedMs() = now },
            pause = object : SendPipeline.Pause { override val paused get() = this@RelayIntegrationTest.paused },
            pacer = {},
        )
    }
    private fun run() = runBlocking { pipeline().runOnce(5) }
    private fun row(id: String) = runBlocking { db.jobs().byId(id) }

    /** In-memory stand-in for claimRelayJobs / authorizeRelaySend / report, using the server's wire shapes. */
    private class FakeServer : Callables {
        data class Job(val id: String, val kind: String?, var status: String = "queued", var attempt: Int = 0, var remainingMs: Long = 60_000)
        val jobs = linkedMapOf<String, Job>()
        val calls = mutableListOf<String>()
        var authorize: (Job) -> Map<String, Any?>? = { mapOf("ok" to true, "sendWithinMs" to 15_000L) }
        val reports = mutableListOf<Pair<String, String>>()

        fun add(id: String, kind: String?) { jobs[id] = Job(id, kind) }
        fun requeue(id: String) { jobs.getValue(id).status = "queued" }
        fun report(id: String, reason: String) { reports += id to reason }

        override suspend fun call(name: String, data: Map<String, Any?>): Any? {
            calls += name
            return when (name) {
                "claimRelayJobs" -> {
                    @Suppress("UNCHECKED_CAST")
                    assertTrue("send-auth capability declared", (data["clientCaps"] as List<String>).contains("send-auth-v1"))
                    val out = jobs.values.filter { it.status == "queued" }.map { j ->
                        j.status = "claimed"; j.attempt++
                        val otp = j.kind != null
                        mapOf("jobId" to j.id, "phoneE164" to "+970599100001", "messageBody" to "body ${j.id}",
                            "assignedSimSubscriptionId" to null, "traceId" to j.id, "kind" to j.kind,
                            "requiresSendAuth" to otp, "sendWithinMs" to (if (otp) j.remainingMs else null), "attempt" to j.attempt)
                    }
                    mapOf("jobs" to out, "capacityExhausted" to null)
                }
                "authorizeRelaySend" -> authorize(jobs.getValue(data["jobId"] as String)) ?: throw RuntimeException("UNAVAILABLE")
                else -> mapOf<String, Any?>()
            }
        }
    }

    @Test fun verificationCode_authorizedOnce_durableRowBeforeHandOff_neverResent() {
        server.add("pauth_a", "phone_auth_otp")
        var rowAtHandOff: String? = null
        onDurableSending = { rowAtHandOff = row("pauth_a")?.localStatus }
        assertEquals(listOf(Outcome.Sent("pauth_a")), run())
        assertEquals(listOf("pauth_a#1"), sent)
        assertEquals("sending", rowAtHandOff)
        assertEquals(listOf("claimRelayJobs", "authorizeRelaySend"), server.calls)
        val r = row("pauth_a")!!
        assertEquals(1, r.attempt)
        assertEquals("•••01", r.phoneE164) // only a masked number is stored locally

        // The same attempt handed out again (lost claim response, restart): never re-sent.
        server.requeue("pauth_a"); server.jobs.getValue("pauth_a").attempt-- // same attempt number
        run()
        assertEquals(listOf("pauth_a#1"), sent)
    }

    @Test fun verificationCode_authorizationUnavailable_failsClosed() {
        server.add("pauth_b", "phone_auth_otp")
        server.authorize = { null }
        run()
        assertTrue(sent.isEmpty())
        assertEquals(listOf("pauth_b" to "auth-unavailable"), failed)
    }

    @Test fun verificationCode_refusedAtAuthorization_isSkipped() {
        server.add("pauth_c", "phone_auth_otp")
        server.authorize = { mapOf("ok" to false, "reason" to "country-not-allowed") }
        val out = run()
        assertTrue(sent.isEmpty())
        assertEquals(Outcome.Skipped("pauth_c", "not-authorized:country-not-allowed"), out.single())
        assertEquals("skipped", row("pauth_c")!!.localStatus)
    }

    @Test fun verificationCode_staleAuthorization_isNotSent() {
        server.add("pauth_d", "phone_auth_otp")
        server.authorize = { now += 3_000; mapOf("ok" to true, "sendWithinMs" to 1_000L) }
        run()
        assertTrue(sent.isEmpty())
        assertEquals("expired-on-device", failed.single().second)
    }

    @Test fun businessSms_retryAfterPauseBeforeHandOff_isSentOnceAsTheNextAttempt() {
        server.add("b1", null)
        onDurableSending = { paused = true } // pause lands during the durable write
        assertTrue(run().single() is Outcome.StoppedBatch)
        assertTrue(sent.isEmpty())
        assertEquals("paused", row("b1")!!.localStatus)
        // Server re-queues it (lease reaper / pause handling) as attempt 2.
        paused = false; onDurableSending = {}
        server.requeue("b1")
        run()
        assertEquals(listOf("b1#2"), sent)
        assertEquals(2, row("b1")!!.attempt)
    }

    @Test fun businessSms_newAttemptAfterPossibleHandOff_isReportedAmbiguous_notResent() {
        server.add("b2", null)
        run()
        assertEquals(listOf("b2#1"), sent)
        server.requeue("b2") // e.g. lease lapsed before the report reached the server
        run()
        assertEquals(listOf("b2#1"), sent)
        assertEquals(listOf("b2" to "ambiguous-handoff"), server.reports)
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

    @Test fun roomMigration_1to2_keepsJobsAndPendingReports() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        val name = "relay-migration-test.db"
        ctx.deleteDatabase(name)
        SQLiteDatabase.openOrCreateDatabase(ctx.getDatabasePath(name).apply { parentFile?.mkdirs() }, null).use { v1 ->
            // Schema v1 exactly as Room generated it before this change (no `attempt`).
            v1.execSQL("CREATE TABLE IF NOT EXISTS `jobs` (`jobId` TEXT NOT NULL, `phoneE164` TEXT NOT NULL, `body` TEXT, `simSubscriptionId` INTEGER, `traceId` TEXT NOT NULL, `localStatus` TEXT NOT NULL, `createdAt` INTEGER NOT NULL, `updatedAt` INTEGER NOT NULL, PRIMARY KEY(`jobId`))")
            v1.execSQL("CREATE TABLE IF NOT EXISTS `reports` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `jobId` TEXT NOT NULL, `status` TEXT NOT NULL, `reason` TEXT, `androidResultCode` INTEGER, `simSubscriptionId` INTEGER, `createdAt` INTEGER NOT NULL)")
            v1.execSQL("CREATE TABLE IF NOT EXISTS `logs` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `at` INTEGER NOT NULL, `level` TEXT NOT NULL, `event` TEXT NOT NULL, `detail` TEXT)")
            v1.execSQL("INSERT INTO jobs VALUES ('old-1', '•••01', NULL, NULL, 'old-1', 'sending', 1, 1)")
            v1.execSQL("INSERT INTO reports (jobId, status, reason, androidResultCode, simSubscriptionId, createdAt) VALUES ('old-1', 'sent', NULL, -1, NULL, 1)")
            v1.version = 1
        }
        val migrated = Room.databaseBuilder(ctx, RelayDb::class.java, name)
            .addMigrations(RelayDb.MIGRATION_1_2).allowMainThreadQueries().build()
        try {
            runBlocking {
                val old = migrated.jobs().byId("old-1")!!
                assertEquals(0, old.attempt)            // pre-upgrade rows read as attempt 0
                assertEquals("sending", old.localStatus) // so a new attempt for it is refused as ambiguous
                assertEquals(1, migrated.reports().count()) // pending delivery report survived
            }
        } finally { migrated.close(); ctx.deleteDatabase(name) }
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
