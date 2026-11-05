import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The emulator does not consistently enforce the production cross-service
// limit. Keep a conservative, transitive call-site budget as well as the
// emulator authorization tests. Counting all branches is intentionally stricter
// than counting only the branch taken by a particular request.
// https://firebase.google.com/docs/storage/security/rules-conditions#enhance_with_firestore
function firestoreAccessSites(rules: string): Set<number> {
  const source = rules.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, match => ' '.repeat(match.length));
  const bodyEnd = (start: number) => {
    let depth = 0;
    let quote = '';
    for (let i = start; i < source.length; i++) {
      const char = source[i];
      if (quote) {
        if (char.charCodeAt(0) === 92) i++;
        else if (char === quote) quote = '';
      } else if (char === "'" || char === '"') quote = char;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) return i;
    }
    throw new Error('Unclosed Storage rules body');
  };
  const helpers = new Map<string, { start: number; end: number }>();
  for (const match of source.matchAll(/\bfunction\s+(\w+)\s*\([^)]*\)\s*\{/g)) {
    const start = match.index! + match[0].length - 1;
    if (helpers.has(match[1])) throw new Error(`Ambiguous helper ${match[1]}; update the read-budget analysis`);
    helpers.set(match[1], { start, end: bodyEnd(start) });
  }
  const header = 'match /chatMedia/{conversationId}/{senderId}/{messageId}/{file} {';
  const matchStart = source.indexOf(header);
  if (matchStart < 0) throw new Error('chatMedia rules not found');
  const start = matchStart + header.length - 1;
  const seenHelpers = new Set<string>();
  const reads = new Set<number>();
  const visit = (from: number, to: number) => {
    const body = source.slice(from, to);
    for (const match of body.matchAll(/\bfirestore\.(?:get|exists)\s*\(/g)) reads.add(from + match.index!);
    for (const call of body.matchAll(/\b(\w+)\s*\(/g)) {
      const helper = helpers.get(call[1]);
      if (!helper || seenHelpers.has(call[1])) continue;
      seenHelpers.add(call[1]);
      visit(helper.start, helper.end);
    }
  };
  visit(start, bodyEnd(start));
  return reads;
}

describe('chat media Storage Firestore access budget', () => {
  it('uses only the live conversation and message reservation, including transitive helpers', () => {
    const rules = readFileSync(resolve(__dirname, '../../storage.rules'), 'utf8');
    expect(firestoreAccessSites(rules).size).toBe(2);
  });

  it('detects a third read hidden behind a group-only helper', () => {
    const rules = readFileSync(resolve(__dirname, '../../storage.rules'), 'utf8');
    const injected = rules.replace(
      'function activeParticipant(conversationId) {',
      `function extraGroupCheck(conversationId) {
        return firestore.get(/databases/(default)/documents/conversations/$(conversationId)/members/$(request.auth.uid)).data.status == 'active';
      }
      function activeParticipant(conversationId) {
        let extra = extraGroupCheck(conversationId);`,
    );
    expect(injected).not.toBe(rules);
    expect(firestoreAccessSites(injected).size).toBe(3);
  });
});
