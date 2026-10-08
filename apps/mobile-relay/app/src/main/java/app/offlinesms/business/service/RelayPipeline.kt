package app.offlinesms.business.service

import app.offlinesms.business.data.db.JobDao
import app.offlinesms.business.data.db.JobEntity
import app.offlinesms.business.net.ClaimedJob
import app.offlinesms.business.net.RelayApi
import app.offlinesms.business.util.RelayLog

/** SendPipeline.Backend over the relay callables (RelayApi → Callables transport). */
class RelayApiBackend(private val deviceId: String) : SendPipeline.Backend {
    override suspend fun claim(capacity: Int) = RelayApi.claim(deviceId, capacity)
    override suspend fun authorize(jobId: String) = RelayApi.authorizeSend(deviceId, jobId)
}

/** SendPipeline.LocalJobs over Room. The row keeps the server attempt (schema v2)
 *  and only a masked phone number. */
class RoomLocalJobs(
    private val dao: JobDao,
    private val now: () -> Long = System::currentTimeMillis,
) : SendPipeline.LocalJobs {
    override suspend fun get(jobId: String) =
        dao.byId(jobId)?.let { SendPipeline.LocalJob(it.jobId, it.attempt, it.localStatus) }

    override suspend fun put(job: ClaimedJob, localStatus: String) {
        val t = now()
        dao.upsert(JobEntity(job.jobId, RelayLog.maskPhone(job.phoneE164), job.body,
            job.simSubscriptionId, job.traceId, localStatus, t, t, job.attempt))
    }

    override suspend fun setStatus(jobId: String, localStatus: String) =
        dao.setStatus(jobId, localStatus, now())
}

/** The production wiring of the send loop; RelayService supplies the Android-only
 *  pieces (SmsManager transport, durable Reporter, SystemClock, SecureStore pause). */
fun relayPipeline(
    deviceId: String,
    dao: JobDao,
    transport: SendPipeline.Transport,
    reports: SendPipeline.Reports,
    clock: SendPipeline.Clock,
    pause: SendPipeline.Pause,
    pacer: suspend () -> Unit,
) = SendPipeline(RelayApiBackend(deviceId), RoomLocalJobs(dao), transport, reports, clock, pause, pacer)
