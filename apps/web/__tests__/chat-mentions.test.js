import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Use the production bundler to load the shared mobile TypeScript helper on Node 20.
const { outputFiles: [bundle] } = await build({
  entryPoints: [fileURLToPath(new URL('../chat-mentions.js', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', tsconfigRaw: { compilerOptions: {} }, write: false,
});
const { memberQuery, updateMentionSpans } = await import(`data:text/javascript;base64,${Buffer.from(bundle.contents).toString('base64')}`);

const first = { userId: 'first', displayName: 'Ali', startIndex: 0, endIndex: 4 };
const second = { userId: 'second', displayName: 'Ali', startIndex: 5, endIndex: 9 };

test('preserves the selected user when editing duplicate names', () => {
  assert.deepEqual(updateMentionSpans('@Ali @Ali', '@Ali', [first, second], { start: 0, end: 5 }),
    [{ ...second, startIndex: 0, endIndex: 4 }]);
  assert.deepEqual(updateMentionSpans('@Ali @Ali', '@Ali', [first, second], { start: 4, end: 9 }), [first]);
  assert.deepEqual(updateMentionSpans('@Ali @Ali', '@Ali', [first, second]), []);
});

test('shifts a selected span by UTF-16 indices and drops tokens modified within or attached to a word', () => {
  assert.deepEqual(updateMentionSpans('@Ali', '🙂 @Ali', [first], { start: 0, end: 0 }),
    [{ ...first, startIndex: 3, endIndex: 7 }]);
  assert.deepEqual(updateMentionSpans('@Ali', '@Arli', [first], { start: 2, end: 2 }), []);
  assert.deepEqual(updateMentionSpans('@Ali', '@Aliم', [first], { start: 4, end: 4 }), []);
});

test('finds queries at the caret without matching emails, selections or previously chosen tokens', () => {
  assert.deepEqual(memberQuery('نعم @علي،', 7, 7), { query: 'عل', start: 4, end: 8 });
  assert.deepEqual(memberQuery('@alice.', 3, 3), { query: 'al', start: 0, end: 6 });
  assert.equal(memberQuery('person@example.com', 12, 12), null);
  assert.equal(memberQuery('@alice@example.com', 3, 3), null);
  assert.equal(memberQuery('@Ali', 1, 3), null);
  assert.equal(memberQuery('@Ali', 3, 3, [first]), null);
});
