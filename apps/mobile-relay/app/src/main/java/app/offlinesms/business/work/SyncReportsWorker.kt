package app.offlinesms.business.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.offlinesms.business.data.SecureStore
import app.offlinesms.business.data.db.RelayDb
import app.offlinesms.business.net.RelayApi
import app.offlinesms.business.util.RelayLog
import com.google.firebase.functions.FirebaseFunctionsException

/** Flushes pending delivery reports to the backend (see [flushReports]); retries
 *  transient failures so a report is never lost across reconnects/restarts. */
class SyncReportsWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val store = SecureStore.get(applicationContext)
        val deviceId = store.deviceId ?: return Result.success()
        val dao = RelayDb.get(applicationContext).reports()
        val r = flushReports(
            dao,
            send = { RelayApi.report(deviceId, it.jobId, it.attempt, it.status, it.reason, it.androidResultCode, it.simSubscriptionId) },
            isPermanent = ::isPermanentRefusal,
            onDropped = { rep, e -> RelayLog.warn(applicationContext, "report", "dropped job=${rep.jobId}: ${e.message?.take(60)}") },
        )
        if (r.kept > 0) RelayLog.warn(applicationContext, "report", "retry later: ${r.kept} pending")
        // Retry while anything is still pending (including reports inserted meanwhile).
        return if (r.kept > 0 || dao.count() > 0) Result.retry() else Result.success()
    }
}

/** The server definitively refused the report (unknown job, wrong business or
 *  device, malformed): retrying can never succeed. Everything else is retried. */
fun isPermanentRefusal(e: Exception): Boolean = e is FirebaseFunctionsException && e.code in setOf(
    FirebaseFunctionsException.Code.NOT_FOUND, FirebaseFunctionsException.Code.PERMISSION_DENIED,
    FirebaseFunctionsException.Code.INVALID_ARGUMENT, FirebaseFunctionsException.Code.FAILED_PRECONDITION,
)
