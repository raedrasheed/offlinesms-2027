#!/usr/bin/env node
// Prints every function this source deploys, one name per line, sorted: the
// release groups of scripts/release/function-groups.json, which
// functions/__tests__/releaseFunctionGroups.test.ts keeps equal to the exports
// of functions/src/index.ts (94 today). Used by check-runtime.sh.
import { readFileSync } from 'node:fs';

const groups = JSON.parse(readFileSync(new URL('./function-groups.json', import.meta.url), 'utf8'));
const names = new Set(Object.entries(groups).filter(([k]) => !k.startsWith('_')).flatMap(([, list]) => list));
console.log([...names].sort().join('\n'));
