import { normalizePhoneAndCountry } from './phoneCountry';
import { ORG_MSG_BODY_MAX, ORG_MSG_MAX_RECIPIENTS } from './orgMessagingValidation';

export const RECIPIENT_GROUP_MAX = ORG_MSG_MAX_RECIPIENTS;
export const RECIPIENT_GROUP_NAME_MAX = 80;
export const RECIPIENT_WORKBOOK_MAX_BYTES = 2 * 1024 * 1024;
export const RECIPIENT_NAME_MAX = 120;

export type GroupRecipient = { name: string; phone: string; message?: string | null };
export type WorkbookPreview = {
  recipients: GroupRecipient[];
  invalidRows: { row: number; error: string }[];
  duplicateRows: number[];
  hasMessageColumn?: true;
};

const NAME_HEADERS = new Set(['name', 'full name', 'الاسم', 'اسم', 'الاسم الكامل', 'اسم المستلم']);
const PHONE_HEADERS = new Set(['phone', 'phone number', 'mobile', 'mobile number', 'الهاتف', 'رقم الهاتف', 'رقم الجوال', 'الجوال']);
const MESSAGE_HEADERS = new Set(['message', 'الرسالة', 'نص الرسالة']);
const E164 = /^\+[1-9]\d{6,14}$/;
const MESSAGE_ERROR = `Enter a message of 1–${ORG_MSG_BODY_MAX} characters or leave it blank.`;

function header(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/[\s_-]+/g, ' ')
    : '';
}

function digits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) & 15));
}

function parseRecipientMessage(value: unknown): string | null | undefined {
  if (value == null) return null;
  if (typeof value !== 'string') return undefined;
  const message = value.trim();
  return message.length <= ORG_MSG_BODY_MAX ? message || null : undefined;
}

export function parseGroupRecipient(value: unknown): GroupRecipient | null {
  if (!value || typeof value !== 'object') return null;
  const { name, phone, message: rawMessage } = value as Partial<GroupRecipient>;
  if (typeof name !== 'string' || typeof phone !== 'string') return null;
  const cleanedName = name.trim();
  if (!cleanedName || cleanedName.length > RECIPIENT_NAME_MAX || /[\u0000-\u001f\u007f]/.test(cleanedName)) return null;
  const compactPhone = digits(phone.trim()).replace(/[\s().-]/g, '');
  if (!E164.test(compactPhone)) return null;
  const normalized = normalizePhoneAndCountry(compactPhone);
  if (!normalized.isValid) return null;
  const recipient = { name: cleanedName, phone: normalized.e164 };
  if (rawMessage === undefined) return recipient;
  const message = parseRecipientMessage(rawMessage);
  return message === undefined ? null : { ...recipient, message };
}

export function parseInternationalGroupRecipient(name: unknown, phone: unknown): GroupRecipient | null {
  let rawPhone: string;
  if (typeof phone === 'string') rawPhone = digits(phone.trim());
  else if (typeof phone === 'number' && Number.isSafeInteger(phone)) rawPhone = String(phone);
  else return null;

  const internationalPhone = `+${rawPhone}`;
  if (!E164.test(internationalPhone)) return parseGroupRecipient({ name, phone });
  const recipient = parseGroupRecipient({ name, phone: internationalPhone });
  return recipient?.phone === internationalPhone ? recipient : null;
}

export function isRecipientGroupId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

export function parseRecipientGroupName(value: unknown): string | null {
  const name = typeof value === 'string' ? value.trim() : '';
  return name && name.length <= RECIPIENT_GROUP_NAME_MAX ? name : null;
}

export function parseRecipientWorkbook(rows: readonly (readonly unknown[])[]): WorkbookPreview | { error: string } {
  const headings = (rows[0] ?? []).map(header);
  const nameColumns = headings.flatMap((value, index) => NAME_HEADERS.has(value) ? [index] : []);
  const phoneColumns = headings.flatMap((value, index) => PHONE_HEADERS.has(value) ? [index] : []);
  const messageColumns = headings.flatMap((value, index) => MESSAGE_HEADERS.has(value) ? [index] : []);
  if (nameColumns.length !== 1 || phoneColumns.length !== 1) {
    return { error: 'The first row must contain one Name column and one Phone column (الاسم، رقم الهاتف).' };
  }
  if (messageColumns.length > 1) return { error: 'The first row must contain at most one Message column (الرسالة).' };
  const [nameColumn] = nameColumns;
  const [phoneColumn] = phoneColumns;
  const messageColumn = messageColumns.at(0);
  const recipients: GroupRecipient[] = [];
  const invalidRows: WorkbookPreview['invalidRows'] = [];
  const duplicateRows: number[] = [];
  const seen = new Map<string, GroupRecipient>();
  let rowCount = 0;
  const blank = (value: unknown) => value == null || (typeof value === 'string' && !value.trim());
  for (const [index, row] of rows.entries()) {
    if (index === 0) continue;
    const name = row[nameColumn];
    const phone = row[phoneColumn];
    const rawMessage = messageColumn === undefined ? undefined : row[messageColumn];
    if (blank(name) && blank(phone) && blank(rawMessage)) continue;
    if (++rowCount > RECIPIENT_GROUP_MAX) {
      return { error: `Import at most ${RECIPIENT_GROUP_MAX} rows at a time.` };
    }
    const rowNumber = index + 1;
    const parsed = parseInternationalGroupRecipient(name, phone);
    if (!parsed) {
      invalidRows.push({ row: rowNumber, error: 'Enter a name and a valid international phone number with its country code.' });
      continue;
    }
    if (messageColumn !== undefined) {
      const message = parseRecipientMessage(typeof rawMessage === 'number' && Number.isFinite(rawMessage) ? String(rawMessage) : rawMessage);
      if (message === undefined) {
        invalidRows.push({ row: rowNumber, error: MESSAGE_ERROR });
        continue;
      }
      parsed.message = message;
    }
    const previous = seen.get(parsed.phone);
    if (previous) {
      if (previous.message !== parsed.message) {
        invalidRows.push({ row: rowNumber, error: 'Use the same message in every row with the same phone number.' });
      } else {
        duplicateRows.push(rowNumber);
      }
      continue;
    }
    seen.set(parsed.phone, parsed);
    recipients.push(parsed);
  }
  if (rowCount === 0) return { error: 'The worksheet contains no recipients.' };
  return { recipients, invalidRows, duplicateRows, ...(messageColumn !== undefined && { hasMessageColumn: true }) };
}
