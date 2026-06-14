// Email delivery abstraction.
//
// All providers implement the same `sendEmail(message)` contract. The active
// provider is chosen by the EMAIL_PROVIDER env var (default 'resend'). Secrets
// are read from environment variables only — never hardcode keys here. The
// message body (which contains the OTP) is NEVER logged by any provider.

import { sendViaResend } from './providers/resend';
import { sendViaConsole } from './providers/console';

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type EmailProvider = (message: EmailMessage) => Promise<void>;

/** Resolve the active provider from EMAIL_PROVIDER (default 'resend'). */
function activeProvider(): EmailProvider {
  const name = (process.env.EMAIL_PROVIDER ?? 'resend').trim().toLowerCase();
  switch (name) {
    case 'resend':  return sendViaResend;
    case 'console': return sendViaConsole; // local/dev: no real send, no body logged
    default:
      throw new Error(`Unknown EMAIL_PROVIDER '${name}' (expected 'resend' or 'console').`);
  }
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  await activeProvider()(message);
}
