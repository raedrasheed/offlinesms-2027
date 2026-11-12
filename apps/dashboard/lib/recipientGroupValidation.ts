import { normalizePhoneAndCountry } from './phoneCountry';
import { ORG_MSG_MAX_RECIPIENTS } from './orgMessagingValidation';

export const RECIPIENT_GROUP_MAX = ORG_MSG_MAX_RECIPIENTS;
export const RECIPIENT_WORKBOOK_MAX_BYTES = 2 * 1024 * 1024;
export const RECIPIENT_NAME_MAX = 120;

export type GroupRecipient = { name: string; phone: string };
export type WorkbookPreview = {
  recipients: GroupRecipient[];
  invalidRows: { row: number; error: string }[];
  duplicateRows: number[];
};

const NAME_HEADERS = new Set(['name', 'full name', 'الاسم', 'اسم', 'الاسم الكامل', 'اسم المستلم']);
const PHONE_HEADERS = new Set(['phone', 'phone number', 'mobile', 'mobile number', 'الهاتف', 'رقم الهاتف', 'رقم الجوال', 'الجوال']);
const E164 = /^\+[1-9]\d{6,14}$/;

function header(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/[\s_-]+/g, ' ')
    : '';
}

function digits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) & 15));
}

export function parseGroupRecipient(value: unknown): GroupRecipient | null {
  if (!value || typeof value !== 'object') return null;
  const { name, phone } = value as Partial<GroupRecipient>;
  if (typeof name !== 'string' || typeof phone !== 'string') return null;
  const cleanedName = name.trim();
  if (!cleanedName || cleanedName.length > RECIPIENT_NAME_MAX || /[\u0000-\u001f\u007f]/.test(cleanedName)) return null;
  const compactPhone = digits(phone.trim()).replace(/[\s().-]/g, '');
  if (!E164.test(compactPhone)) return null;
  const normalized = normalizePhoneAndCountry(compactPhone);
  return normalized.isValid ? { name: cleanedName, phone: normalized.e164 } : null;
}

export function isRecipientGroupId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

export function parseRecipientWorkbook(rows: readonly (readonly unknown[])[]): WorkbookPreview | { error: string } {
  const headings = (rows[0] ?? []).map(header);
  const nameColumns = headings.flatMap((value, index) => NAME_HEADERS.has(value) ? [index] : []);
  const phoneColumns = headings.flatMap((value, index) => PHONE_HEADERS.has(value) ? [index] : []);
  if (nameColumns.length !== 1 || phoneColumns.length !== 1) {
    return { error: 'The first row must contain one Name column and one Phone column (الاسم، رقم الهاتف).' };
  }
  const [nameColumn] = nameColumns;
  const [phoneColumn] = phoneColumns;
  const recipients: GroupRecipient[] = [];
  const invalidRows: WorkbookPreview['invalidRows'] = [];
  const duplicateRows: number[] = [];
  const seen = new Set<string>();
  let rowCount = 0;
  const blank = (value: unknown) => value == null || (typeof value === 'string' && !value.trim());
  for (const [index, row] of rows.entries()) {
    if (index === 0) continue;
    const name = row[nameColumn];
    const phone = row[phoneColumn];
    if (blank(name) && blank(phone)) continue;
    if (++rowCount > RECIPIENT_GROUP_MAX) {
      return { error: `Import at most ${RECIPIENT_GROUP_MAX} rows at a time.` };
    }
    const rowNumber = index + 1;
    const parsed = parseGroupRecipient({ name, phone });
    if (!parsed) {
      invalidRows.push({ row: rowNumber, error: 'Enter a name and a valid international phone number as text, including + and country code.' });
      continue;
    }
    if (seen.has(parsed.phone)) {
      duplicateRows.push(rowNumber);
      continue;
    }
    seen.add(parsed.phone);
    recipients.push(parsed);
  }
  if (rowCount === 0) return { error: 'The worksheet contains no recipients.' };
  return { recipients, invalidRows, duplicateRows };
}
