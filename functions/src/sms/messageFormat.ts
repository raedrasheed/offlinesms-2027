// Pure SMS formatting and transport-unit accounting. Every displayed prefix and
// separator is part of the billed body. No transliteration or smart encoding.
const GSM_BASIC = new Set(Array.from('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'));
const GSM_EXTENDED = new Set(Array.from('\f^{}\\[~]|€'));
export const SMS_POINTS_PER_SEGMENT = 28;
export type SmsEncoding = 'GSM-7' | 'UCS-2';
export interface SmsMetrics { smsSegments: number; smsEncoding: SmsEncoding; smsUnits: number }
export interface SmsFormatSettings {
  appName?: unknown;
  smsShowAppName?: unknown;
  smsShowGroupName?: unknown;
  smsShowSenderPhone?: unknown;
}

export function calculateSmsMetrics(body: string): SmsMetrics {
  const characters = Array.from(body);
  const gsm = characters.every(c => GSM_BASIC.has(c) || GSM_EXTENDED.has(c));
  const lengths = characters.map(c => gsm ? (GSM_EXTENDED.has(c) ? 2 : 1) : c.length);
  const smsUnits = lengths.reduce((n, length) => n + length, 0);
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  let smsSegments = smsUnits === 0 ? 0 : 1;
  if (smsUnits > single) {
    let used = 0;
    // A GSM escape sequence or UTF-16 surrogate pair cannot be split across
    // parts. Counting ceil(total/capacity) alone undercounts at these boundaries.
    for (const length of lengths) {
      if (used + length > multi) { smsSegments++; used = 0; }
      used += length;
    }
  }
  return { smsSegments, smsEncoding: gsm ? 'GSM-7' : 'UCS-2', smsUnits };
}

function line(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\r\n\t\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
}

export function composeSmsBody(body: string, settings: SmsFormatSettings, context: {
  groupName?: string | null; senderPhone?: string | null;
} = {}): string {
  const prefix: string[] = [];
  if (settings.smsShowAppName === true) prefix.push(`[${line(settings.appName, 60) || 'OfflineSMS'}]`);
  const group = line(context.groupName, 120);
  if (settings.smsShowGroupName === true && group) prefix.push(`[${group}]`);
  if (settings.smsShowSenderPhone === true && /^\+[1-9]\d{6,14}$/.test(context.senderPhone ?? '')) prefix.push(context.senderPhone!);
  return prefix.length ? `${prefix.join('\n')}\n\n${body}` : body;
}

/** Old in-flight batches keep their original one-message price. New batches
 * snapshot a unit cost once; settings changes never reprice a dispatched SMS. */
export function smsBatchUnitCost(batch: { pointsPerRecipient?: unknown; smsPricingVersion?: unknown }): number {
  return batch.smsPricingVersion === 1 && typeof batch.pointsPerRecipient === 'number'
    && Number.isSafeInteger(batch.pointsPerRecipient) && batch.pointsPerRecipient >= SMS_POINTS_PER_SEGMENT
    ? batch.pointsPerRecipient : SMS_POINTS_PER_SEGMENT;
}
