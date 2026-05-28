package app.offlinesms.business.sms

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.telephony.SmsManager
import app.offlinesms.business.net.ClaimedJob

object SmsEngine {
    const val ACTION_SENT = "app.offlinesms.business.SMS_SENT"
    const val ACTION_DELIVERED = "app.offlinesms.business.SMS_DELIVERED"
    const val EXTRA_JOB_ID = "jobId"
    const val EXTRA_PART_COUNT = "partCount"

    @Suppress("DEPRECATION")
    private fun managerFor(context: Context, subId: Int?): SmsManager {
        return if (subId != null && subId >= 0) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                context.getSystemService(SmsManager::class.java).createForSubscriptionId(subId)
            else SmsManager.getSmsManagerForSubscriptionId(subId)
        } else {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                context.getSystemService(SmsManager::class.java)
            else SmsManager.getDefault()
        }
    }

    private fun pending(context: Context, action: String, jobId: String, partCount: Int, part: Int): PendingIntent {
        val intent = Intent(context, SmsResultReceiver::class.java).setAction(action)
            .putExtra(EXTRA_JOB_ID, jobId)
            .putExtra(EXTRA_PART_COUNT, partCount)
        // Unique requestCode per (job, action, part) so PendingIntents don't collapse.
        val rc = (jobId + action + part).hashCode()
        return PendingIntent.getBroadcast(
            context, rc, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** Send one job's SMS (multipart + Unicode aware). Results arrive via
     *  SmsResultReceiver, which reports sent/delivered/failed to the backend. */
    fun send(context: Context, job: ClaimedJob) {
        val sms = managerFor(context, job.simSubscriptionId)
        val parts = sms.divideMessage(job.body)
        val n = parts.size
        val sentIntents = ArrayList<PendingIntent>(n)
        val deliveredIntents = ArrayList<PendingIntent>(n)
        for (i in 0 until n) {
            sentIntents.add(pending(context, ACTION_SENT, job.jobId, n, i))
            deliveredIntents.add(pending(context, ACTION_DELIVERED, job.jobId, n, i))
        }
        sms.sendMultipartTextMessage(job.phoneE164, null, parts, sentIntents, deliveredIntents)
    }
}
