import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import CountryMap from '../app/admin/reports/CountryMap';
import type { Geography, AnalyticsReport } from '../lib/analytics';
vi.mock('next/dynamic', () => ({ default: () => () => null }));
import { analyticsCsv } from '../app/admin/reports/AnalyticsConsole';
const { create, act } = require('react-test-renderer');
let root: any;
const data: Geography = { registeredAt: '2026-11-08T12:00:00Z', presenceAt: '2026-11-08T12:01:00Z', total: 13, unknown: 2, onlineUnknown: 1,
  countries: [{ iso: 'PS', name: 'Palestine', registered: 8, active24h: 5, online: 3 }, { iso: 'CA', name: 'Canada', registered: 3, active24h: 1, online: 0 }] };
const outlines = [{ iso: 'PS', name: 'Palestine', path: 'M1,1L2,2Z', x: 598, y: 160 }, { iso: 'CA', name: 'Canada', path: 'M4,4L5,5Z', x: 250, y: 100 }];
const render = () => JSON.stringify(root.toJSON());
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => outlines })); });
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; vi.unstubAllGlobals(); });
const mount = async () => { await act(async () => { root = create(createElement(CountryMap, { data })); }); };
describe('country map interactions and privacy', () => {
  it('loads same-origin outlines and exposes both keyboard selection and country table focus', async () => {
    await mount(); expect(fetch).toHaveBeenCalledWith('/analytics-world.json', expect.objectContaining({ signal: expect.anything() }));
    expect(render()).toContain('not the user’s current physical location'); expect(render()).toContain('Country coverage: ');
    const ps = root.root.findAllByType('path')[0]; await act(async () => ps.props.onKeyDown({ key: 'Enter', preventDefault() {} }));
    expect(root.root.findAllByProps({ 'aria-label': 'Clear selected country' })).toHaveLength(1);
    const focus = root.root.findAllByType('button').find((b: any) => b.children[0] === 'Canada');
    await act(async () => focus.props.onClick()); expect(root.root.findByType('svg').props.viewBox).not.toBe('0 0 1000 500');
    expect(render()).toContain('Canada');
  });
  it('changes metric, zooms and resets without losing the aggregate country table', async () => {
    await mount(); const registered = root.root.findAllByType('button').find((b: any) => b.children[0] === 'Registered');
    const active = root.root.findAllByType('button').find((b: any) => b.children[0] === 'Active now');
    await act(async () => active.props.onClick()); expect(active.props['aria-pressed']).toBe(true); expect(registered.props['aria-pressed']).toBe(false);
    expect(root.root.findAllByType('path')[0].props['aria-label']).toContain('3 Active now');
    await act(async () => root.root.findByProps({ 'aria-label': 'Zoom in' }).props.onClick()); expect(root.root.findByType('svg').props.viewBox).not.toBe('0 0 1000 500');
    await act(async () => root.root.findByProps({ 'aria-label': 'Reset map' }).props.onClick()); expect(root.root.findByType('svg').props.viewBox).toBe('0 0 1000 500');
    await act(async () => root.root.findByType('input').props.onChange({ target: { value: 'Canada' } }));
    const rows = root.root.findByType('tbody').findAllByType('tr'); expect(rows).toHaveLength(1); expect(rows[0].findByType('button').children[0]).toBe('Canada');
  });
  it('keeps statistics available if the map asset cannot load', async () => {
    vi.mocked(fetch).mockRejectedValue(Error('offline')); await mount();
    expect(render()).toContain('Map outlines could not load'); expect(render()).toContain('Palestine'); expect(render()).toContain('Canada');
  });
  it('does not substitute zero for unavailable current activity', async () => {
    await act(async () => { root = create(createElement(CountryMap, { data: { ...data, onlineUnknown: null, countries: data.countries.map(c => ({ ...c, online: null })) } })); });
    const active = root.root.findAllByType('button').find((b: any) => b.children[0] === 'Active now'); await act(async () => active.props.onClick());
    expect(render()).toContain('—'); expect(root.root.findAllByType('path')[0].props['aria-label']).not.toContain('0 Active now');
  });
});
describe('aggregate export', () => {
  it('exports actual zeros, missing values, exact date windows, definitions and country coverage without formulas or private identities', () => {
    const report: AnalyticsReport = { range: '7d', scope: 'Platform', updatedAt: data.registeredAt, issues: ['Unavailable source'], limitations: ['Phone country is not GPS'], sections: [
      { key: 'x', title: 'SMS', note: '', metrics: [{ key: 'a', label: '=not a formula', value: 0, note: 'Settled "points"' }, { key: 'b', label: 'Missing', value: null, note: '' }] },
    ] };
    const csv = analyticsCsv(report, { updatedAt: data.presenceAt, geography: data, showUsers: false } as any);
    expect(csv).toContain('"\'=not a formula"'); expect(csv).toContain('"Settled ""points"""'); expect(csv).toContain('"0"'); expect(csv).toContain('"Missing","",""');
    expect(csv).toContain('Phone country is not GPS'); expect(csv).toContain('Unknown country'); expect(csv).toContain('Palestine (PS)'); expect(csv).not.toMatch(/phoneNumber|userPrivate|displayName/);
  });
});
