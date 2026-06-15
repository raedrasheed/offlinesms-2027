// Derive a country (name + flag) from an E.164 phone numbers calling code.
//
// Self-contained for the dashboard (cannot import the mobile app). The table is
// generated from the mobile country list and sorted longest-dial-first so the
// longest matching calling code wins (e.g. +1242 Bahamas before +1). Calling
// codes shared by several countries resolve to the canonical primary country.

import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export type PhoneCountry = { iso: string; name: string; flag: string };

// Sorted longest dial first for greedy prefix matching.
const DIAL_COUNTRIES: { dial: string; iso: string; name: string }[] = [
  { dial: "211", iso: "SS", name: "South Sudan" },
  { dial: "212", iso: "MA", name: "Morocco" },
  { dial: "213", iso: "DZ", name: "Algeria" },
  { dial: "216", iso: "TN", name: "Tunisia" },
  { dial: "218", iso: "LY", name: "Libya" },
  { dial: "220", iso: "GM", name: "Gambia" },
  { dial: "221", iso: "SN", name: "Senegal" },
  { dial: "222", iso: "MR", name: "Mauritania" },
  { dial: "223", iso: "ML", name: "Mali" },
  { dial: "224", iso: "GN", name: "Guinea" },
  { dial: "225", iso: "CI", name: "Côte d’Ivoire" },
  { dial: "226", iso: "BF", name: "Burkina Faso" },
  { dial: "227", iso: "NE", name: "Niger" },
  { dial: "228", iso: "TG", name: "Togo" },
  { dial: "229", iso: "BJ", name: "Benin" },
  { dial: "230", iso: "MU", name: "Mauritius" },
  { dial: "231", iso: "LR", name: "Liberia" },
  { dial: "232", iso: "SL", name: "Sierra Leone" },
  { dial: "233", iso: "GH", name: "Ghana" },
  { dial: "234", iso: "NG", name: "Nigeria" },
  { dial: "235", iso: "TD", name: "Chad" },
  { dial: "236", iso: "CF", name: "Central African Republic" },
  { dial: "237", iso: "CM", name: "Cameroon" },
  { dial: "238", iso: "CV", name: "Cape Verde" },
  { dial: "239", iso: "ST", name: "São Tomé and Príncipe" },
  { dial: "240", iso: "GQ", name: "Equatorial Guinea" },
  { dial: "241", iso: "GA", name: "Gabon" },
  { dial: "242", iso: "CG", name: "Congo - Brazzaville" },
  { dial: "243", iso: "CD", name: "Congo - Kinshasa" },
  { dial: "244", iso: "AO", name: "Angola" },
  { dial: "245", iso: "GW", name: "Guinea-Bissau" },
  { dial: "248", iso: "SC", name: "Seychelles" },
  { dial: "249", iso: "SD", name: "Sudan" },
  { dial: "250", iso: "RW", name: "Rwanda" },
  { dial: "251", iso: "ET", name: "Ethiopia" },
  { dial: "252", iso: "SO", name: "Somalia" },
  { dial: "253", iso: "DJ", name: "Djibouti" },
  { dial: "254", iso: "KE", name: "Kenya" },
  { dial: "255", iso: "TZ", name: "Tanzania" },
  { dial: "256", iso: "UG", name: "Uganda" },
  { dial: "257", iso: "BI", name: "Burundi" },
  { dial: "258", iso: "MZ", name: "Mozambique" },
  { dial: "260", iso: "ZM", name: "Zambia" },
  { dial: "261", iso: "MG", name: "Madagascar" },
  { dial: "263", iso: "ZW", name: "Zimbabwe" },
  { dial: "264", iso: "NA", name: "Namibia" },
  { dial: "265", iso: "MW", name: "Malawi" },
  { dial: "266", iso: "LS", name: "Lesotho" },
  { dial: "267", iso: "BW", name: "Botswana" },
  { dial: "268", iso: "SZ", name: "Eswatini" },
  { dial: "269", iso: "KM", name: "Comoros" },
  { dial: "291", iso: "ER", name: "Eritrea" },
  { dial: "297", iso: "AW", name: "Aruba" },
  { dial: "351", iso: "PT", name: "Portugal" },
  { dial: "352", iso: "LU", name: "Luxembourg" },
  { dial: "353", iso: "IE", name: "Ireland" },
  { dial: "354", iso: "IS", name: "Iceland" },
  { dial: "355", iso: "AL", name: "Albania" },
  { dial: "356", iso: "MT", name: "Malta" },
  { dial: "357", iso: "CY", name: "Cyprus" },
  { dial: "358", iso: "FI", name: "Finland" },
  { dial: "359", iso: "BG", name: "Bulgaria" },
  { dial: "370", iso: "LT", name: "Lithuania" },
  { dial: "371", iso: "LV", name: "Latvia" },
  { dial: "372", iso: "EE", name: "Estonia" },
  { dial: "373", iso: "MD", name: "Moldova" },
  { dial: "374", iso: "AM", name: "Armenia" },
  { dial: "375", iso: "BY", name: "Belarus" },
  { dial: "376", iso: "AD", name: "Andorra" },
  { dial: "377", iso: "MC", name: "Monaco" },
  { dial: "378", iso: "SM", name: "San Marino" },
  { dial: "380", iso: "UA", name: "Ukraine" },
  { dial: "381", iso: "RS", name: "Serbia" },
  { dial: "382", iso: "ME", name: "Montenegro" },
  { dial: "385", iso: "HR", name: "Croatia" },
  { dial: "386", iso: "SI", name: "Slovenia" },
  { dial: "387", iso: "BA", name: "Bosnia and Herzegovina" },
  { dial: "389", iso: "MK", name: "North Macedonia" },
  { dial: "420", iso: "CZ", name: "Czechia" },
  { dial: "421", iso: "SK", name: "Slovakia" },
  { dial: "423", iso: "LI", name: "Liechtenstein" },
  { dial: "501", iso: "BZ", name: "Belize" },
  { dial: "502", iso: "GT", name: "Guatemala" },
  { dial: "503", iso: "SV", name: "El Salvador" },
  { dial: "504", iso: "HN", name: "Honduras" },
  { dial: "505", iso: "NI", name: "Nicaragua" },
  { dial: "506", iso: "CR", name: "Costa Rica" },
  { dial: "507", iso: "PA", name: "Panama" },
  { dial: "509", iso: "HT", name: "Haiti" },
  { dial: "591", iso: "BO", name: "Bolivia" },
  { dial: "592", iso: "GY", name: "Guyana" },
  { dial: "593", iso: "EC", name: "Ecuador" },
  { dial: "595", iso: "PY", name: "Paraguay" },
  { dial: "597", iso: "SR", name: "Suriname" },
  { dial: "598", iso: "UY", name: "Uruguay" },
  { dial: "670", iso: "TL", name: "Timor-Leste" },
  { dial: "673", iso: "BN", name: "Brunei" },
  { dial: "674", iso: "NR", name: "Nauru" },
  { dial: "675", iso: "PG", name: "Papua New Guinea" },
  { dial: "676", iso: "TO", name: "Tonga" },
  { dial: "677", iso: "SB", name: "Solomon Islands" },
  { dial: "678", iso: "VU", name: "Vanuatu" },
  { dial: "679", iso: "FJ", name: "Fiji" },
  { dial: "680", iso: "PW", name: "Palau" },
  { dial: "685", iso: "WS", name: "Samoa" },
  { dial: "686", iso: "KI", name: "Kiribati" },
  { dial: "688", iso: "TV", name: "Tuvalu" },
  { dial: "691", iso: "FM", name: "Micronesia" },
  { dial: "692", iso: "MH", name: "Marshall Islands" },
  { dial: "850", iso: "KP", name: "North Korea" },
  { dial: "852", iso: "HK", name: "Hong Kong" },
  { dial: "853", iso: "MO", name: "Macao" },
  { dial: "855", iso: "KH", name: "Cambodia" },
  { dial: "856", iso: "LA", name: "Laos" },
  { dial: "880", iso: "BD", name: "Bangladesh" },
  { dial: "886", iso: "TW", name: "Taiwan" },
  { dial: "960", iso: "MV", name: "Maldives" },
  { dial: "961", iso: "LB", name: "Lebanon" },
  { dial: "962", iso: "JO", name: "Jordan" },
  { dial: "963", iso: "SY", name: "Syria" },
  { dial: "964", iso: "IQ", name: "Iraq" },
  { dial: "965", iso: "KW", name: "Kuwait" },
  { dial: "966", iso: "SA", name: "Saudi Arabia" },
  { dial: "967", iso: "YE", name: "Yemen" },
  { dial: "968", iso: "OM", name: "Oman" },
  { dial: "970", iso: "PS", name: "Palestine" },
  { dial: "971", iso: "AE", name: "United Arab Emirates" },
  { dial: "972", iso: "IL", name: "Israel" },
  { dial: "973", iso: "BH", name: "Bahrain" },
  { dial: "974", iso: "QA", name: "Qatar" },
  { dial: "975", iso: "BT", name: "Bhutan" },
  { dial: "976", iso: "MN", name: "Mongolia" },
  { dial: "977", iso: "NP", name: "Nepal" },
  { dial: "992", iso: "TJ", name: "Tajikistan" },
  { dial: "993", iso: "TM", name: "Turkmenistan" },
  { dial: "994", iso: "AZ", name: "Azerbaijan" },
  { dial: "995", iso: "GE", name: "Georgia" },
  { dial: "996", iso: "KG", name: "Kyrgyzstan" },
  { dial: "998", iso: "UZ", name: "Uzbekistan" },
  { dial: "20", iso: "EG", name: "Egypt" },
  { dial: "27", iso: "ZA", name: "South Africa" },
  { dial: "30", iso: "GR", name: "Greece" },
  { dial: "31", iso: "NL", name: "Netherlands" },
  { dial: "32", iso: "BE", name: "Belgium" },
  { dial: "33", iso: "FR", name: "France" },
  { dial: "34", iso: "ES", name: "Spain" },
  { dial: "36", iso: "HU", name: "Hungary" },
  { dial: "39", iso: "IT", name: "Italy" },
  { dial: "40", iso: "RO", name: "Romania" },
  { dial: "41", iso: "CH", name: "Switzerland" },
  { dial: "43", iso: "AT", name: "Austria" },
  { dial: "44", iso: "GB", name: "United Kingdom" },
  { dial: "45", iso: "DK", name: "Denmark" },
  { dial: "46", iso: "SE", name: "Sweden" },
  { dial: "47", iso: "NO", name: "Norway" },
  { dial: "48", iso: "PL", name: "Poland" },
  { dial: "49", iso: "DE", name: "Germany" },
  { dial: "51", iso: "PE", name: "Peru" },
  { dial: "52", iso: "MX", name: "Mexico" },
  { dial: "53", iso: "CU", name: "Cuba" },
  { dial: "54", iso: "AR", name: "Argentina" },
  { dial: "55", iso: "BR", name: "Brazil" },
  { dial: "56", iso: "CL", name: "Chile" },
  { dial: "57", iso: "CO", name: "Colombia" },
  { dial: "58", iso: "VE", name: "Venezuela" },
  { dial: "60", iso: "MY", name: "Malaysia" },
  { dial: "61", iso: "AU", name: "Australia" },
  { dial: "62", iso: "ID", name: "Indonesia" },
  { dial: "63", iso: "PH", name: "Philippines" },
  { dial: "64", iso: "NZ", name: "New Zealand" },
  { dial: "65", iso: "SG", name: "Singapore" },
  { dial: "66", iso: "TH", name: "Thailand" },
  { dial: "81", iso: "JP", name: "Japan" },
  { dial: "82", iso: "KR", name: "South Korea" },
  { dial: "84", iso: "VN", name: "Vietnam" },
  { dial: "86", iso: "CN", name: "China" },
  { dial: "90", iso: "TR", name: "Turkey" },
  { dial: "91", iso: "IN", name: "India" },
  { dial: "92", iso: "PK", name: "Pakistan" },
  { dial: "93", iso: "AF", name: "Afghanistan" },
  { dial: "94", iso: "LK", name: "Sri Lanka" },
  { dial: "95", iso: "MM", name: "Myanmar" },
  { dial: "98", iso: "IR", name: "Iran" },
  { dial: "1", iso: "US", name: "United States" },
  { dial: "7", iso: "RU", name: "Russia" },
];

/** All selectable countries (ISO + name), sorted by name — for relay country pickers. */
export const COUNTRY_OPTIONS: { iso: string; name: string }[] =
  DIAL_COUNTRIES.map(c => ({ iso: c.iso, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

/** Regional-indicator flag emoji for a 2-letter ISO code, e.g. PS -> 🇵🇸. */
export function flagEmoji(iso: string): string {
  return iso
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

/** Resolve the country for an E.164 phone number, or null if unknown. */
export function phoneCountry(phone?: string | null): PhoneCountry | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  for (const c of DIAL_COUNTRIES) {
    if (digits.startsWith(c.dial)) {
      return { iso: c.iso, name: c.name, flag: flagEmoji(c.iso) };
    }
  }
  return null;
}

// ── Country-based relay routing: normalize + detect ISO country ──────────────
// Mirror of packages/shared/phoneCountry.ts (the dashboard org-messaging API
// does the country check synchronously, so it needs this in its own runtime).

export type NormalizedPhone = {
  e164: string;
  countryCode: string | null;
  isValid: boolean;
  reason?: string;
};

/** Normalize a phone number and detect its ISO alpha-2 country (libphonenumber-js). */
export function normalizePhoneAndCountry(inputPhone: string, defaultCountry?: string): NormalizedPhone {
  if (typeof inputPhone !== "string" || inputPhone.trim() === "") {
    return { e164: "", countryCode: null, isValid: false, reason: "empty" };
  }
  let parsed;
  try {
    parsed = parsePhoneNumberFromString(inputPhone.trim(), defaultCountry as CountryCode | undefined);
  } catch {
    return { e164: "", countryCode: null, isValid: false, reason: "parse-error" };
  }
  if (!parsed) {
    return { e164: "", countryCode: null, isValid: false, reason: "unparseable" };
  }
  if (!parsed.isValid()) {
    return { e164: parsed.number ?? "", countryCode: parsed.country ?? null, isValid: false, reason: "invalid" };
  }
  return { e164: parsed.number, countryCode: parsed.country ?? null, isValid: true };
}

/** Format an E.164 number for display: +<code> <rest>. */
export function formatE164(phone?: string | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "—";
  const c = DIAL_COUNTRIES.find(c => digits.startsWith(c.dial));
  if (!c) return `+${digits}`;
  return `+${c.dial} ${digits.slice(c.dial.length)}`;
}
