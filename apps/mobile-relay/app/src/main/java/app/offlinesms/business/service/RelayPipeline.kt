package app.offlinesms.business.service

import androidx.room.withTransaction
import app.offlinesms.business.data.db.JobDao
import app.offlinesms.business.data.db.JobEntity
import app.offlinesms.business.data.db.RelayDb
import app.offlinesms.business.net.ClaimedJob
import app.offlinesms.business.net.RelayApi
import app.offlinesms.business.util.RelayLog
import app.offlinesms.business.work.ReportStore

/** SendPipeline.Backend over the relay callables (RelayApi → Callables transport). */
class RelayApiBackend(private val deviceId: String) : SendPipeline.Backend {
    override suspend fun claim(capacity: Int) = RelayApi.claim(deviceId, capacity)
    override suspend fun authorize(jobId: String) = RelayApi.authorizeSend(deviceId, jobId)
}

/** SendPipeline.LocalJobs over Room. The row keeps the server attempt, the sticky
 *  no-resend mark (schema v3) and only a masked phone number. No write here ever
 *  sets noResend to false: there is no REPLACE; a newer attempt takes the row
 *  over with a conditional UPDATE that leaves noResend untouched (Q2). */
class RoomLocalJobs(
    private val db: RelayDb,
    private val dao: JobDao = db.jobs(),
    private val now: () -> Long = System::currentTimeMillis,
) : SendPipeline.LocalJobs {
    override suspend fun admit(job: ClaimedJob): String? = db.withTransaction {
        val row = dao.byId(job.jobId)
        val d = SendPipeline.dedup(row?.let { SendPipeline.LocalJob(it.jobId, it.attempt, it.localStatus, it.noResend) }, job)
        if (d != null) return@withTransaction d
        val t = now()
        val phone = RelayLog.maskPhone(job.phoneE164)
        val written = if (row == null) {
            dao.insert(JobEntity(job.jobId, phone, job.body, job.simSubscriptionId, job.traceId, "claimed", t, t, job.attempt)) != -1L
        } else {
            dao.takeOver(job.jobId, job.attempt, phone, job.body, job.simSubscriptionId, job.traceId, "claimed", t) == 1
        }
        // Not written ⇒ the row changed after the read (e.g. a no-resend mark):
        // refuse conservatively instead of trusting the earlier decision.
        if (written) null else "ambiguous-handoff"
    }

    override suspend fun beginSending(jobId: String, attempt: Int): Boolean =
        dao.beginSending(jobId, attempt, now()) == 1

    /** States after which this attempt's body is never needed again (privacy):
     *  a refused verification code ('skipped') and a business SMS stopped before
     *  hand-off ('paused' — a retry arrives as a new attempt with its own body). */
    override suspend fun setStatus(jobId: String, attempt: Int, localStatus: String) =
        if (localStatus in BODY_DONE) dao.finalize(jobId, attempt, localStatus, now())
        else dao.setStatus(jobId, attempt, localStatus, now())

    private companion object { val BODY_DONE = setOf("skipped", "paused") }
}

/** SendPipeline.Reports over the production [ReportStore] (awaited) + flush kick. */
class StoreReports(
    private val store: ReportStore,
    private val afterRecord: (jobId: String, reason: String) -> Unit = { _, _ -> },
) : SendPipeline.Reports {
    override suspend fun failed(jobId: String, attempt: Int, reason: String, noResend: Boolean) {
        store.record(jobId, attempt, "failed", reason, null, noResend)
        afterRecord(jobId, reason)
    }
}

/** The production wiring of the send loop; RelayService supplies the Android-only
 *  pieces (SmsManager transport, durable Reporter, SystemClock, SecureStore pause). */
fun relayPipeline(
    deviceId: String,
    db: RelayDb,
    dao: JobDao = db.jobs(),
    transport: SendPipeline.Transport,
    reports: SendPipeline.Reports,
    clock: SendPipeline.Clock,
    pause: SendPipeline.Pause,
    pacer: suspend () -> Unit,
) = SendPipeline(RelayApiBackend(deviceId), RoomLocalJobs(db, dao), transport, reports, clock, pause, pacer)
