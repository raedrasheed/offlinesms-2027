package app.offlinesms.business.sms

/**
 * Pure aggregation of SmsManager per-part results into ONE outcome per
 * (job, attempt, sent|delivered) — results of different attempts never mix.
 *
 *  sent:      every part OK          → "sent"
 *             every part failed      → "failed" (carrier-send-failed: nothing
 *                                       went out, so the server may retry)
 *             some OK, some failed   → "failed" + noResend (ambiguous-partial-send:
 *                                       part of the text reached the network, so
 *                                       a retry would duplicate it)
 *  delivered: every part delivered   → "delivered"; otherwise no report
 */
class SendResultAggregator {
    enum class Kind { SENT, DELIVERED }
    data class Outcome(val status: String, val reason: String?, val noResend: Boolean)

    private class Progress(val total: Int) { var received = 0; var ok = 0 }
    private val progress = HashMap<String, Progress>()

    /** Returns the outcome when the last part of this (job, attempt, kind) arrives, else null. */
    @Synchronized
    fun onPart(jobId: String, attempt: Int?, kind: Kind, total: Int, ok: Boolean): Outcome? {
        val key = "$jobId#${attempt ?: "-"}#$kind"
        val p = progress.getOrPut(key) { Progress(maxOf(1, total)) }
        p.received++
        if (ok) p.ok++
        if (p.received < p.total) return null
        progress.remove(key)
        return when (kind) {
            Kind.SENT -> when (p.ok) {
                p.total -> Outcome("sent", null, noResend = true)
                0 -> Outcome("failed", "carrier-send-failed", noResend = false)
                else -> Outcome("failed", "ambiguous-partial-send", noResend = true)
            }
            Kind.DELIVERED -> if (p.ok == p.total) Outcome("delivered", null, noResend = true) else null
        }
    }
}
