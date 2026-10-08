package app.offlinesms.business.sms

import app.offlinesms.business.sms.SendResultAggregator.Kind
import app.offlinesms.business.sms.SendResultAggregator.Outcome
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SendResultAggregatorTest {
    @Test fun allPartsOk_sent_andMarkedNoResend() {
        val a = SendResultAggregator()
        assertNull(a.onPart("j", 1, Kind.SENT, 2, true))
        assertEquals(Outcome("sent", null, true), a.onPart("j", 1, Kind.SENT, 2, true))
    }
    @Test fun allPartsFailed_isARetryableFailure() {
        val a = SendResultAggregator()
        a.onPart("j", 1, Kind.SENT, 2, false)
        assertEquals(Outcome("failed", "carrier-send-failed", false), a.onPart("j", 1, Kind.SENT, 2, false))
    }
    @Test fun partialSend_isAmbiguous_neverRetried() {
        val a = SendResultAggregator()
        a.onPart("j", 1, Kind.SENT, 3, true)
        a.onPart("j", 1, Kind.SENT, 3, false)
        assertEquals(Outcome("failed", "ambiguous-partial-send", true), a.onPart("j", 1, Kind.SENT, 3, true))
    }
    @Test fun attemptsNeverMix() {
        val a = SendResultAggregator()
        assertNull(a.onPart("j", 1, Kind.SENT, 2, false))
        assertNull(a.onPart("j", 2, Kind.SENT, 2, true))  // would have completed attempt 1 if keyed by job only
        assertEquals(Outcome("sent", null, true), a.onPart("j", 2, Kind.SENT, 2, true))
        assertEquals(Outcome("failed", "carrier-send-failed", false), a.onPart("j", 1, Kind.SENT, 2, false))
    }
    @Test fun deliveredOnlyWhenEveryPartIsDelivered() {
        val a = SendResultAggregator()
        a.onPart("j", 1, Kind.DELIVERED, 2, true)
        assertNull(a.onPart("j", 1, Kind.DELIVERED, 2, false))
    }
}
