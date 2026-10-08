package app.offlinesms.business.service

import app.offlinesms.business.service.SendGate.Decision
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SendGateTest {
    private val verification = SendGate.Candidate("pauth_1", requiresSendAuth = true, sendWithinMs = 60_000, receivedAtElapsedMs = 1_000)
    private val business = SendGate.Candidate("b:1", requiresSendAuth = false, sendWithinMs = null, receivedAtElapsedMs = 1_000)

    @Test fun pauseIsCheckedBeforeEveryJob() {
        assertEquals(Decision.StopBatch, SendGate.beforeSend(paused = true, insertedNew = true, c = business, nowElapsedMs = 2_000))
        assertEquals(Decision.StopBatch, SendGate.beforeSend(paused = true, insertedNew = true, c = verification, nowElapsedMs = 2_000))
    }

    @Test fun duplicateLocalJobIsNeverSentAgain() {
        val d = SendGate.beforeSend(paused = false, insertedNew = false, c = verification, nowElapsedMs = 2_000)
        assertTrue(d is Decision.Skip)
        assertTrue(SendGate.beforeSend(false, false, business, 2_000) is Decision.Skip)
    }

    @Test fun businessJobsSendWithoutAuthorization() {
        assertEquals(Decision.Send, SendGate.beforeSend(false, true, business, 2_000))
    }

    @Test fun verificationJobsNeedAuthorizationAndADeadline() {
        assertEquals(Decision.NeedsAuthorization, SendGate.beforeSend(false, true, verification, 2_000))
        assertEquals(Decision.Fail("expired-on-device"), SendGate.beforeSend(false, true, verification, 61_000))
        assertEquals(Decision.Fail("no-deadline"), SendGate.beforeSend(false, true, verification.copy(sendWithinMs = null), 2_000))
    }

    @Test fun authorizationFailsClosed() {
        assertEquals(Decision.Fail("auth-unavailable"), SendGate.afterAuthorization(null, null, false, verification, 2_000))
        assertTrue(SendGate.afterAuthorization(false, "challenge-not-current", false, verification, 2_000) is Decision.Skip)
        assertEquals(Decision.Fail("paused-after-auth"), SendGate.afterAuthorization(true, null, true, verification, 2_000))
        assertEquals(Decision.Fail("expired-on-device"), SendGate.afterAuthorization(true, null, false, verification, 61_000))
        assertEquals(Decision.Send, SendGate.afterAuthorization(true, null, false, verification, 2_000))
    }
}
