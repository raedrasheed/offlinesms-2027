// Console email provider — local/dev only.
//
// Does NOT send a real email. Logs only that a message *would* be sent, with the
// recipient redacted and WITHOUT the subject or body (the body contains the
// OTP). Select with EMAIL_PROVIDER=console for local testing against the
// emulator; read the actual code from the Firestore challenge doc during tests.

import type { EmailMessage } from '../index';
import { redactEmail } from '../../auditLog';

export async function sendViaConsole(message: EmailMessage): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`[email:console] would send to ${redactEmail(message.to)} (body suppressed)`);
}
