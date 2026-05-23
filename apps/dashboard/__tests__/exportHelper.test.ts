import { describe, it, expect } from 'vitest';
import { csvCell, csvRow, EXPORT_LIMIT } from '../lib/exportHelper';

describe('csvCell', () => {
  it('returns empty string for null/undefined', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('returns plain value when no special chars', () => {
    expect(csvCell('hello')).toBe('hello');
    expect(csvCell(123)).toBe('123');
    expect(csvCell(true)).toBe('true');
    expect(csvCell(false)).toBe('false');
  });

  it('quotes values that contain commas', () => {
    expect(csvCell('a,b,c')).toBe('"a,b,c"');
  });

  it('quotes and escapes embedded double quotes', () => {
    expect(csvCell('she said "hi"')).toBe('"she said ""hi"""');
  });

  it('quotes values with newlines', () => {
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('does not double-quote already-safe text', () => {
    expect(csvCell('safe_text-123')).toBe('safe_text-123');
  });
});

describe('csvRow', () => {
  it('joins cells with commas', () => {
    expect(csvRow(['a', 'b', 'c'])).toBe('a,b,c');
  });

  it('handles mixed types', () => {
    expect(csvRow(['name', 42, true, null])).toBe('name,42,true,');
  });

  it('escapes cells with commas while keeping the separator outside', () => {
    expect(csvRow(['plain', 'has,comma', 'plain2'])).toBe('plain,"has,comma",plain2');
  });

  it('handles a row of all unsafe values', () => {
    expect(csvRow(['"q"', '\n', 'a,b'])).toBe('"""q""","\n","a,b"');
  });
});

describe('EXPORT_LIMIT', () => {
  it('caps exports at 1000 rows', () => {
    expect(EXPORT_LIMIT).toBe(1000);
  });
});
