package app.offlinesms.business.ui

import android.content.Context
import androidx.core.text.BidiFormatter
import androidx.core.text.TextDirectionHeuristicsCompat
import app.offlinesms.business.R
import app.offlinesms.business.data.db.LogEntity
import app.offlinesms.business.util.RelayLog
import java.text.DateFormat
import java.util.Date

/** Presents old and new local records without interpreting a log line as a delivery receipt. */
object RelayActivityText {
    enum class Tone { INFO, SUCCESS, WARNING, ERROR }
    data class Entry(val title: String, val explanation: String, val time: String,
                     val reference: String?, val details: String, val tone: Tone) {
        val needsAttention get() = tone == Tone.WARNING || tone == Tone.ERROR
    }

    fun format(ctx: Context, log: LogEntity): Entry {
        val raw = log.detail.orEmpty()
        fun token(key: String) = Regex("(?:^|\\s)${Regex.escape(key)}=([^\\s]+)")
            .find(raw)?.groupValues?.get(1)
        val job = token("job")?.trimEnd(':')
        val attempt = token("attempt")?.toIntOrNull()?.takeIf { it > 0 }
        val reason = token("reason") ?: if (log.event == "not-sent") raw.substringAfter(' ', "").trim() else null
        val uncertain = reason in setOf("ambiguous-handoff", "ambiguous-send-exception", "ambiguous-partial-send")
        val problem = log.level == "warn" || log.level == "error"
        val pair = when (log.event) {
            "send" -> R.string.log_sending to R.string.log_sending_desc
            "sent" -> R.string.log_sent to R.string.log_sent_desc
            "delivered" -> R.string.log_delivered to R.string.log_delivered_desc
            "failed", "not-sent" -> when {
                uncertain -> R.string.log_uncertain to R.string.log_uncertain_desc
                reason == "expired-on-device" -> R.string.log_not_sent to R.string.log_expired_desc
                reason == "paused-after-auth" -> R.string.log_not_sent to R.string.log_paused_desc
                reason == "auth-unavailable" -> R.string.log_not_sent to R.string.log_auth_desc
                reason == "no-deadline" -> R.string.log_not_sent to R.string.log_deadline_desc
                reason == "carrier-send-failed" -> R.string.log_failed to R.string.log_carrier_desc
                else -> R.string.log_failed to R.string.log_failed_desc
            }
            "claim" -> if (problem || raw.startsWith("err:")) R.string.log_claim_error to R.string.log_claim_error_desc
                       else R.string.log_processed to R.string.log_processed_desc
            "heartbeat" -> if (problem) R.string.log_heartbeat_error to R.string.log_heartbeat_error_desc
                           else R.string.log_heartbeat to R.string.log_heartbeat_desc
            "report" -> when {
                raw.startsWith("retry later:") -> R.string.log_report_waiting to R.string.log_report_waiting_desc
                raw.startsWith("dropped ") -> R.string.log_report_rejected to R.string.log_report_rejected_desc
                else -> R.string.log_report to R.string.log_report_desc
            }
            "enroll" -> if (problem) R.string.log_enroll_error to R.string.log_enroll_error_desc
                        else R.string.log_enrolled to R.string.log_enrolled_desc
            else -> R.string.log_other to R.string.log_other_desc
        }
        val tone = when {
            uncertain -> Tone.WARNING
            log.level == "error" || log.event == "failed" -> Tone.ERROR
            problem || log.event == "not-sent" || (log.event == "claim" && raw.startsWith("err:")) -> Tone.WARNING
            log.event in setOf("sent", "delivered", "enroll") -> Tone.SUCCESS
            else -> Tone.INFO
        }
        val locale = ctx.resources.configuration.locales[0]
        val time = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.MEDIUM, locale).format(Date(log.at))
        val bidi = BidiFormatter.getInstance(locale)
        fun ltr(text: String) = bidi.unicodeWrap(text, TextDirectionHeuristicsCompat.LTR)
        val extra = mutableListOf<String>()
        if (log.event == "claim" && !problem && !raw.startsWith("err:")) {
            token("n")?.toIntOrNull()?.takeIf { it >= 0 }?.let { extra += ctx.getString(R.string.log_task_count, it) }
        }
        if (log.event == "send") token("to")?.let {
            // Never trust a legacy detail to already be masked.
            val masked = if (it.matches(Regex("•{1,3}[0-9]{0,2}"))) it else RelayLog.maskPhone(it)
            extra += ctx.getString(R.string.log_recipient, ltr(masked))
        }
        if (attempt != null) extra += ctx.getString(R.string.log_attempt, attempt)
        val technical = mutableListOf(time, ctx.getString(R.string.log_event, ltr(log.event)))
        if (job != null) technical += ctx.getString(R.string.log_job, ltr(job))
        if (attempt != null) technical += ctx.getString(R.string.log_attempt, attempt)
        // Only known machine fields: arbitrary exception text can contain private data.
        if (reason != null && reason.matches(Regex("[a-z-]{1,60}"))) {
            technical += ctx.getString(R.string.log_reason, ltr(reason))
        }
        token("result")?.toIntOrNull()?.let { technical += ctx.getString(R.string.log_result, it) }
        return Entry(ctx.getString(pair.first), (listOf(ctx.getString(pair.second)) + extra).joinToString("\n"), time,
            job?.let { ctx.getString(R.string.log_reference, ltr("…" + it.takeLast(8))) },
            technical.joinToString("\n\n"), tone)
    }
}
