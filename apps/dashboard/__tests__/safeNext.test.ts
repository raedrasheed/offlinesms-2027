import { describe, it, expect } from 'vitest';
import { safeNextPath } from '../lib/safeNext';

describe('safeNextPath', () => {
  it('keeps a dashboard path', () => {
    expect(safeNextPath('/admin/relay?org=a')).toBe('/admin/relay?org=a');
    expect(safeNextPath('/admin')).toBe('/admin');
  });

  it('falls back to /admin for anything that could leave the dashboard', () => {
    for (const v of [null, undefined, '', 'https://evil.example', '//evil.example', '/\\evil.example',
      '\\\\evil.example', 'javascript:alert(1)', 'admin', '/\t/evil.example']) {
      expect(safeNextPath(v), String(v)).toBe('/admin');
    }
  });
});
