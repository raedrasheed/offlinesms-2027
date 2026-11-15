import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMessageLink, messageLinks } from '../message-links.js';

test('finds HTTP, HTTPS and www links without absorbing surrounding punctuation', () => {
  const text = '🚀 راجع «https://example.org/docs_(chapter)»، و(http://example.net/view?a=1)، ثم www.example.com!';
  const links = messageLinks(text);
  assert.deepEqual(links.map(({ value, href }) => [value, href]), [
    ['https://example.org/docs_(chapter)', 'https://example.org/docs_(chapter)'],
    ['http://example.net/view?a=1', 'http://example.net/view?a=1'],
    ['www.example.com', 'https://www.example.com/'],
  ]);
  assert.deepEqual(links.map(({ start, end }) => text.slice(start, end)), links.map(({ value }) => value));
});

test('keeps invalid, embedded and unsupported addresses as plain text', () => {
  const text = 'javascript:alert(1) javascript:https://example.org name@www.example.org '
    + 'https://example.org@other.example https:///example.org https://example.org\\@other.example';
  assert.deepEqual(messageLinks(text), []);
});

test('opens ordinary links safely in a new tab and keeps invite clicks in the app', (context) => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'a');
      return { addEventListener(type, listener) { this[type] = listener; } };
    },
  };
  context.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  const inviteUrl = 'https://links.offlinesms.com/join/ABCDEFGH';
  const opened = [];
  const options = {
    inviteCode: (href) => href === inviteUrl ? 'ABCDEFGH' : null,
    openInvite: (code) => opened.push(code),
  };
  const external = createMessageLink(messageLinks('www.example.org')[0], options);
  assert.equal(external.href, 'https://www.example.org/');
  assert.equal(external.target, '_blank');
  assert.equal(external.rel, 'noopener noreferrer');
  assert.equal(external.textContent, 'www.example.org');

  const invite = createMessageLink(messageLinks(inviteUrl)[0], options);
  assert.equal(invite.href, '/#join=ABCDEFGH');
  let prevented = 0;
  const event = { button: 0, preventDefault() { prevented++; } };
  invite.click({ ...event, ctrlKey: true });
  assert.deepEqual(opened, []);
  invite.click(event);
  assert.deepEqual(opened, ['ABCDEFGH']);
  assert.equal(prevented, 1);
});
