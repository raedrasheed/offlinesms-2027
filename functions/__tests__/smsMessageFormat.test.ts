import { describe, expect, it } from 'vitest';
import { calculateSmsMetrics, composeSmsBody, smsBatchUnitCost } from '../src/sms/messageFormat';
import { smsQuoteToken } from '../src/sms/messageContent';

describe('SMS transport segment billing', () => {
  it.each([
    ['', 0, 0, 'GSM-7'], ['a'.repeat(160), 160, 1, 'GSM-7'],
    ['a'.repeat(161), 161, 2, 'GSM-7'], ['a'.repeat(306), 306, 2, 'GSM-7'],
    ['a'.repeat(307), 307, 3, 'GSM-7'], ['^'.repeat(80), 160, 1, 'GSM-7'],
    ['^'.repeat(81), 162, 2, 'GSM-7'],
    ['a'.repeat(152) + '^' + 'b'.repeat(152), 306, 3, 'GSM-7'],
    ['ش'.repeat(70), 70, 1, 'UCS-2'], ['ش'.repeat(71), 71, 2, 'UCS-2'],
    ['ش'.repeat(134), 134, 2, 'UCS-2'], ['ش'.repeat(135), 135, 3, 'UCS-2'],
    ['ش'.repeat(66) + '😀' + 'ش'.repeat(66), 134, 3, 'UCS-2'],
    ['😀'.repeat(35), 70, 1, 'UCS-2'], ['😀'.repeat(36), 72, 2, 'UCS-2'],
    ['£éΔ\n\r', 5, 1, 'GSM-7'], ['{}[]\\^~|€\f', 20, 1, 'GSM-7'],
  ])('counts transport units/parts for %j', (body, units, segments, encoding) => {
    expect(calculateSmsMetrics(body as string)).toEqual({ smsUnits: units, smsSegments: segments, smsEncoding: encoding });
  });
  it('metadata, punctuation and separators cross the actual boundary', () => {
    const body = 'a'.repeat(150);
    expect(calculateSmsMetrics(body).smsSegments).toBe(1);
    const output = composeSmsBody(body, { smsShowAppName: true });
    expect(output).toBe(`[OfflineSMS]\n\n${body}`);
    expect(calculateSmsMetrics(output)).toEqual({ smsEncoding: 'GSM-7', smsUnits: 166, smsSegments: 2 });
  });
});

describe('trusted metadata format', () => {
  it.each([
    [false, false, false, 'text'],
    [true, false, false, '[OfflineSMS]\n\ntext'],
    [false, true, false, '[Team]\n\ntext'],
    [false, false, true, '+970599123456\n\ntext'],
    [true, true, false, '[OfflineSMS]\n[Team]\n\ntext'],
    [true, false, true, '[OfflineSMS]\n+970599123456\n\ntext'],
    [false, true, true, '[Team]\n+970599123456\n\ntext'],
    [true, true, true, '[OfflineSMS]\n[Team]\n+970599123456\n\ntext'],
  ])('independent flags %s/%s/%s', (app, group, sender, expected) => {
    expect(composeSmsBody('text', { smsShowAppName: app, smsShowGroupName: group, smsShowSenderPhone: sender }, {
      groupName: 'Team', senderPhone: '+970599123456',
    })).toBe(expected);
  });
  it('omits missing group/phone and normalizes metadata to one line', () => {
    expect(composeSmsBody('a\nb', { appName: '  Example\nApp ', smsShowAppName: true, smsShowGroupName: true, smsShowSenderPhone: true }))
      .toBe('[Example App]\n\na\nb');
  });
  it('legacy batches retain old price while versioned batches use the snapshot', () => {
    expect(smsBatchUnitCost({})).toBe(28);
    expect(smsBatchUnitCost({ pointsPerRecipient: 84 })).toBe(28);
    expect(smsBatchUnitCost({ smsPricingVersion: 1, pointsPerRecipient: 84 })).toBe(84);
  });
  it('quotes bind only canonical fields and recipient order is immaterial', () => {
    const context = { uid: 'u', conversationId: 'c', messageId: 'm', audience: 'everyone', finalSmsBody: 'Hi', pointsPerRecipient: 28, recipients: [{ uid: 'b', phone: '+970599111111' }, { uid: 'a', phone: '+970599222222' }] };
    expect(smsQuoteToken({ ...context, smsUnits: 2, smsSegments: 1 } as typeof context)).toBe(smsQuoteToken({ ...context, recipients: [...context.recipients].reverse() }));
    expect(smsQuoteToken({ ...context, finalSmsBody: 'Bye' })).not.toBe(smsQuoteToken(context));
    expect(smsQuoteToken({ ...context, recipients: [] })).not.toBe(smsQuoteToken(context));
  });
});
