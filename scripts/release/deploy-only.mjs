#!/usr/bin/env node
// Prints the firebase deploy --only list of one production deploy group
// (scripts/release/function-groups.json), so no function name is typed by hand:
//   npx firebase deploy --project offlinesms-prod-2027 --only "$(node scripts/release/deploy-only.mjs chat)"
import { readFileSync } from 'node:fs';

const groups = JSON.parse(readFileSync(new URL('./function-groups.json', import.meta.url), 'utf8'));
const name = process.argv[2];
const list = name && !name.startsWith('_') ? groups[name] : undefined;
if (!Array.isArray(list)) {
  console.error(`usage: deploy-only.mjs <${Object.keys(groups).filter(k => !k.startsWith('_')).join('|')}>`);
  process.exit(2);
}
console.log(list.map(f => `functions:${f}`).join(','));
