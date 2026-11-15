import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getClipboardImage } from '../chat-attachments.js';

const png = new File(['image'], 'screenshot.png', { type: 'image/png' });
const pdf = new File(['document'], 'document.pdf', { type: 'application/pdf' });
const fileItem = file => ({ kind: 'file', getAsFile: () => file });

test('finds the image file in mixed clipboard items', () => {
  const items = [{ kind: 'string', type: 'text/html' }, fileItem(pdf), fileItem(png)];
  assert.equal(getClipboardImage({ items }), png);
});

test('falls back to clipboard files when items do not expose an image', () => {
  assert.equal(getClipboardImage({ items: [fileItem(null)], files: [pdf, png] }), png);
  const unnamedType = new File(['image'], 'clipboard.jpeg');
  assert.equal(getClipboardImage({ files: [unnamedType] }), unnamedType);
});

test('leaves ordinary text, rich text, and non-image files to the browser', () => {
  assert.equal(getClipboardImage({ items: [{ kind: 'string', type: 'text/plain' }], files: [pdf] }), undefined);
  assert.equal(getClipboardImage({ items: [{ kind: 'string', type: 'text/html' }] }), undefined);
  assert.equal(getClipboardImage(null), undefined);
});
