package app.offlinesms.business.work

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import app.offlinesms.business.data.db.RelayDb
import app.offlinesms.business.util.RelayLog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit

/** Durably records a delivery result (see [ReportStore]) and triggers a network-gated flush. */
object Reporter {
    /** Fire-and-forget form for broadcast callbacks. The send loop instead awaits
     *  [record] so its no-resend mark is durable before it continues. */
    fun enqueue(
        context: Context, jobId: String, attempt: Int?, status: String, reason: String?,
        resultCode: Int?, noResend: Boolean = false,
    ) {
        val app = context.applicationContext
        CoroutineScope(Dispatchers.IO).launch { record(app, jobId, attempt, status, reason, resultCode, noResend) }
    }

    suspend fun record(
        context: Context, jobId: String, attempt: Int?, status: String, reason: String?,
        resultCode: Int?, noResend: Boolean = false,
    ) {
        val app = context.applicationContext
        ReportStore(RelayDb.get(app)).record(jobId, attempt, status, reason, resultCode, noResend)
        RelayLog.info(app, status, "job=$jobId attempt=${attempt ?: "?"}")
        kickFlush(app)
    }

    fun kickFlush(context: Context) {
        val req = OneTimeWorkRequestBuilder<SyncReportsWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork("relay-report-sync", ExistingWorkPolicy.APPEND_OR_REPLACE, req)
    }
}
