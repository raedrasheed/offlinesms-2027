#!/usr/bin/env ts-node
// Translation parity checker for OfflineSMS.
//
// Compares all locale files against EN (the reference).
// Exits non-zero if any locale is missing keys that EN has,
// or has keys EN doesn't (orphaned keys).
//
// Usage:
//   npx ts-node scripts/checkI18n.ts
//   node scripts/checkI18n.js    (if compiled)
//
// Output: PASS or a list of missing/orphaned keys per locale.

import * as fs from 'fs';
import * as path from 'path';

const I18N_DIR = path.join(__dirname, '../apps/mobile/src/i18n');

type JsonObj = { [k: string]: string | JsonObj };

function flattenKeys(obj: JsonObj, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) {
      keys.push(...flattenKeys(v as JsonObj, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

function loadLocale(code: string): JsonObj | null {
  const filePath = path.join(I18N_DIR, `${code}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as JsonObj;
}

function getLocales(): string[] {
  return fs.readdirSync(I18N_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

function main() {
  const locales = getLocales();
  if (!locales.includes('en')) {
    console.error('ERROR: en.json not found in', I18N_DIR);
    process.exit(1);
  }

  const enObj = loadLocale('en')!;
  const enKeys = new Set(flattenKeys(enObj));

  let hasErrors = false;

  for (const locale of locales) {
    if (locale === 'en') continue;

    const localeObj = loadLocale(locale);
    if (!localeObj) {
      console.error(`ERROR: Could not load ${locale}.json`);
      hasErrors = true;
      continue;
    }

    const localeKeys = new Set(flattenKeys(localeObj));
    const missing  = [...enKeys].filter(k => !localeKeys.has(k));
    // CLDR plural forms differ per language (Arabic: zero/one/two/few/many/
    // other; English: one/other). A locale may add plural variants of a key EN
    // pluralizes (EN has `<base>_other`); anything else extra is orphaned.
    const PLURAL = /_(zero|one|two|few|many|other)$/;
    const orphaned = [...localeKeys].filter(k =>
      !enKeys.has(k) && !(PLURAL.test(k) && enKeys.has(k.replace(PLURAL, '_other'))));

    if (missing.length === 0 && orphaned.length === 0) {
      console.log(`✓ ${locale}: ${localeKeys.size} keys — parity OK`);
    } else {
      hasErrors = true;
      if (missing.length > 0) {
        console.error(`✗ ${locale}: ${missing.length} missing keys:`);
        for (const k of missing) console.error(`    missing: ${k}`);
      }
      if (orphaned.length > 0) {
        console.warn(`⚠ ${locale}: ${orphaned.length} orphaned keys (in ${locale} but not EN):`);
        for (const k of orphaned) console.warn(`    orphaned: ${k}`);
      }
    }
  }

  if (hasErrors) {
    console.error('\nFAIL: Translation parity check failed.');
    process.exit(1);
  } else {
    console.log('\nPASS: All locales are in parity with EN.');
  }
}

main();
