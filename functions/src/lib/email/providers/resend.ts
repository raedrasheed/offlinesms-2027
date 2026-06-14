// Resend email provider (https://resend.com).
//
// Uses the Resend HTTP API directly via global fetch (Node 20) so we don't add
// an SDK dependency. Credentials come from env vars:
//   RESEND_API_KEY  — required, the Resend API key
//   EMAIL_FROM      — required, the verified sender, e.g. "OfflineSMS <noreply@offlinesms.app>"
// The request body contains the OTP, so it is never logged.

import type { EmailMessage } from '../index';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export async function sendViaResend(message: EmailMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');
  if (!from)   throw new Error('EMAIL_FROM is not set');

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  if (!res.ok) {
    // Surface the status only — the response may echo request details, and the
    // request carried the OTP, so we do not log the body.
    throw new Error(`Resend send failed with status ${res.status}`);
  }
}
