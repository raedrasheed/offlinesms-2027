package app.offlinesms.business.sms

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import app.offlinesms.business.work.Reporter
import java.util.concurrent.ConcurrentHashMap

/**
 * Maps SmsManager sent/delivered PendingIntent results to a relay report.
 * Aggregates multipart results per (jobId, kind): the job is "sent" only when
 * every part is OK; any part failure → "failed". "delivered" is reported only
 * when all parts are delivered (carriers that omit reports simply never fire).
 */
class SmsResultReceiver : BroadcastReceiver() {

    private class Progress(val total: Int) { var received = 0; var anyFail = false }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val jobId = intent.getStringExtra(SmsEngine.EXTRA_JOB_ID) ?: return
        val total = intent.getIntExtra(SmsEngine.EXTRA_PART_COUNT, 1)
        val ok = resultCode == Activity.RESULT_OK

        val key = "$jobId:$action"
        val p = progress.getOrPut(key) { Progress(total) }
        synchronized(p) {
            p.received++
            if (!ok) p.anyFail = true
            if (p.received < p.total) return
            progress.remove(key)
            when (action) {
                SmsEngine.ACTION_SENT ->
                    Reporter.enqueue(context, jobId, if (p.anyFail) "failed" else "sent",
                        reason = if (p.anyFail) "carrier-send-failed" else null, resultCode = resultCode)
                SmsEngine.ACTION_DELIVERED ->
                    if (!p.anyFail) Reporter.enqueue(context, jobId, "delivered", reason = null, resultCode = resultCode)
            }
        }
    }

    companion object { private val progress = ConcurrentHashMap<String, Progress>() }
}
