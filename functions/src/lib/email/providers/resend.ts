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
    // The Resend *response* body is an error object ({statusCode,message,name})
    // — it does NOT echo our request html/text, so it never contains the OTP.
    // Including it makes failures (unverified domain, test-mode recipient, bad
    // key) diagnosable in the function logs.
    let detail = '';
    try { detail = (await res.text()).slice(0, 500); } catch { /* ignore */ }
    throw new Error(`Resend send failed (status ${res.status}): ${detail}`);
  }
}
