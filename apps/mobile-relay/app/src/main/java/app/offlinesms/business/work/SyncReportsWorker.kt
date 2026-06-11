package app.offlinesms.business.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.offlinesms.business.data.SecureStore
import app.offlinesms.business.data.db.RelayDb
import app.offlinesms.business.net.RelayApi
import app.offlinesms.business.util.RelayLog

/** Flushes pending delivery reports to the backend; retries on network failure
 *  so a report is never lost across reconnects/restarts. */
class SyncReportsWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val store = SecureStore.get(applicationContext)
        val deviceId = store.deviceId ?: return Result.success()
        val dao = RelayDb.get(applicationContext).reports()
        val batch = dao.batch()
        if (batch.isEmpty()) return Result.success()
        for (r in batch) {
            try {
                RelayApi.report(deviceId, r.jobId, r.status, r.reason, r.androidResultCode, r.simSubscriptionId)
                dao.delete(r.id)
            } catch (e: Exception) {
                RelayLog.warn(applicationContext, "report", "retry: ${e.message?.take(80)}")
                return Result.retry()
            }
        }
        // Drain anything inserted while we were sending.
        return if (dao.count() > 0) Result.retry() else Result.success()
    }
}
