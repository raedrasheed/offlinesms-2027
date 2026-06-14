// OTP email template (brand + code + expiry + don't-share warning + support).
// Pure string builder — no secrets, no I/O — so it is easily unit-tested.

import type { EmailMessage } from './index';

const BRAND = 'OfflineSMS';
const ACCENT = '#1F7BA8';

export type OtpEmailParams = {
  code: string;
  ttlMinutes: number;
  supportEmail?: string | null;
};

/** Build the verification email. The recipient is filled in by the caller. */
export function renderOtpEmail(params: OtpEmailParams): Omit<EmailMessage, 'to'> {
  const { code, ttlMinutes, supportEmail } = params;
  const subject = `Your ${BRAND} verification code`;

  const supportLineText = supportEmail
    ? `\nNeed help? Contact ${supportEmail}.`
    : '';
  const supportLineHtml = supportEmail
    ? `<p style="color:#667;font-size:13px;margin:16px 0 0">Need help? Contact <a href="mailto:${supportEmail}" style="color:${ACCENT}">${supportEmail}</a>.</p>`
    : '';

  const text =
    `${BRAND} verification code\n\n` +
    `Your verification code is ${code}.\n` +
    `It expires in ${ttlMinutes} minutes.\n\n` +
    `Do not share this code with anyone. ${BRAND} will never ask you for it.\n` +
    `If you didn't request this, you can ignore this email.` +
    supportLineText;

  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">` +
    `<h1 style="font-size:20px;font-weight:800;color:${ACCENT};margin:0 0 4px">${BRAND}</h1>` +
    `<p style="color:#222;font-size:15px;margin:16px 0 8px">Your verification code is:</p>` +
    `<div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#111;background:#f4f6f8;border-radius:12px;padding:16px;text-align:center">${code}</div>` +
    `<p style="color:#444;font-size:14px;margin:16px 0 0">It expires in <strong>${ttlMinutes} minutes</strong>.</p>` +
    `<p style="color:#444;font-size:14px;margin:8px 0 0">Do not share this code with anyone. ${BRAND} will never ask you for it.</p>` +
    `<p style="color:#888;font-size:13px;margin:8px 0 0">If you didn't request this, you can safely ignore this email.</p>` +
    supportLineHtml +
    `</div>`;

  return { subject, html, text };
}
