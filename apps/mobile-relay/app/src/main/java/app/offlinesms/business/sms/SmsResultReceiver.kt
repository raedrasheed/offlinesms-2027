package app.offlinesms.business.sms

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import app.offlinesms.business.work.Reporter

/**
 * Maps SmsManager sent/delivered PendingIntent results to a relay report bound
 * to the server attempt that produced them (see [SendResultAggregator]). A late
 * callback for an older attempt is reported as that attempt and never changes
 * the local row of a newer one.
 */
class SmsResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val kind = when (intent.action) {
            SmsEngine.ACTION_SENT -> SendResultAggregator.Kind.SENT
            SmsEngine.ACTION_DELIVERED -> SendResultAggregator.Kind.DELIVERED
            else -> return
        }
        val jobId = intent.getStringExtra(SmsEngine.EXTRA_JOB_ID) ?: return
        // Intents from builds without attempt identity carry no attempt: reported unbound.
        val attempt = intent.getIntExtra(SmsEngine.EXTRA_ATTEMPT, 0).takeIf { it > 0 }
        val total = intent.getIntExtra(SmsEngine.EXTRA_PART_COUNT, 1)
        val out = aggregator.onPart(jobId, attempt, kind, total, resultCode == Activity.RESULT_OK) ?: return
        Reporter.enqueue(context, jobId, attempt, out.status, out.reason, resultCode, out.noResend)
    }

    companion object { val aggregator = SendResultAggregator() }
}
