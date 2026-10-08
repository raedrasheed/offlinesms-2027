package app.offlinesms.business.work

import androidx.room.withTransaction
import app.offlinesms.business.data.db.RelayDb
import app.offlinesms.business.data.db.ReportDao
import app.offlinesms.business.data.db.ReportEntity

/**
 * Durable record of one send outcome, bound to the attempt it describes. In ONE
 * Room transaction:
 *   • the sticky no-resend mark for the logical job (when the outcome means the
 *     message may already have reached the network: sent/delivered, or an
 *     ambiguous failure) — written before anything relies on the report;
 *   • the pending report (flushed later by [flushReports]);
 *   • the attempt's local status (a result for another attempt never touches
 *     the row of the current one; an unbound result touches no status).
 */
class ReportStore(private val db: RelayDb, private val now: () -> Long = System::currentTimeMillis) {
    suspend fun record(
        jobId: String, attempt: Int?, status: String, reason: String?,
        resultCode: Int?, noResend: Boolean = false,
    ) {
        val t = now()
        db.withTransaction {
            if (noResend || status == "sent" || status == "delivered") db.jobs().markNoResend(jobId, t)
            db.reports().insert(ReportEntity(jobId = jobId, status = status, reason = reason,
                androidResultCode = resultCode, simSubscriptionId = null, createdAt = t, attempt = attempt))
            if (attempt != null) db.jobs().finalize(jobId, attempt, status, t)
        }
    }
}

/** Outcome of one flush pass over the pending reports. */
data class FlushResult(val delivered: Int, val dropped: Int, val kept: Int)

/**
 * Sends every pending report once (oldest first). A report is deleted only
 * after the server answered: accepted, acknowledged as not applicable (stale /
 * duplicate / unbound — the server never applies those to a newer attempt), or
 * definitively refused ([isPermanent]). Transient errors keep it for the next
 * pass and do NOT block the reports queued behind it.
 */
suspend fun flushReports(
    dao: ReportDao,
    send: suspend (ReportEntity) -> Unit,
    isPermanent: (Exception) -> Boolean,
    onDropped: (ReportEntity, Exception) -> Unit = { _, _ -> },
): FlushResult {
    var delivered = 0; var dropped = 0; var kept = 0
    for (r in dao.batch()) {
        try {
            send(r)
            dao.delete(r.id); delivered++
        } catch (e: Exception) {
            if (isPermanent(e)) { dao.delete(r.id); dropped++; onDropped(r, e) } else kept++
        }
    }
    return FlushResult(delivered, dropped, kept)
}
