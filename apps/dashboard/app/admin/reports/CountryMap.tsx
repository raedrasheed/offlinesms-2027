'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { analyticsNumber as fmt, type Geography } from '../../../lib/analytics';

type Outline = { iso: string; name: string; path: string; x: number; y: number };
type Mode = 'registered' | 'online' | 'active24h';
const MODES: { key: Mode; label: string }[] = [{ key: 'registered', label: 'Registered' }, { key: 'online', label: 'Active now' }, { key: 'active24h', label: 'Active 24h' }];
const time = (s: string) => new Date(s).toLocaleTimeString('en-GB', { timeZone: 'UTC' });
export default function CountryMap({ data }: { data: Geography }) {
  const [outlines, setOutlines] = useState<Outline[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<Mode>('registered');
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useState({ x: 500, y: 250, zoom: 1 });
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    fetch('/analytics-world.json', { signal: controller.signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((rows: Outline[]) => { if (alive) setOutlines(rows); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; controller.abort(); };
  }, []);
  const byIso = useMemo(() => new Map(data.countries.map(c => [c.iso, c])), [data.countries]);
  const max = Math.max(1, ...data.countries.map(c => c[mode] ?? 0));
  const selectedRow = selected ? byIso.get(selected) : null;
  const selectedName = selectedRow?.name ?? outlines?.find(o => o.iso === selected)?.name;
  const rows = data.countries.filter(c => `${c.name} ${c.iso}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (b[mode] ?? -1) - (a[mode] ?? -1) || a.name.localeCompare(b.name));
  const position = (x: number, y: number, zoom: number) => {
    const z = Math.min(10, Math.max(1, zoom));
    return { x: Math.max(500 / z, Math.min(1000 - 500 / z, x)), y: Math.max(250 / z, Math.min(500 - 250 / z, y)), zoom: z };
  };
  const focus = (iso: string) => {
    setSelected(iso);
    const o = outlines?.find(r => r.iso === iso);
    if (o) setView(position(o.x, o.y, 4));
  };
  const color = (value: number | null | undefined) => value == null || !value ? 'var(--c-map-empty, #dce8ef)'
    : `hsl(198 72% ${74 - 43 * Math.log1p(value) / Math.log1p(max)}%)`;
  const mapped = new Set(outlines?.map(o => o.iso) ?? []);
  const unmapped = outlines ? data.countries.filter(c => !mapped.has(c.iso)).reduce((n, c) => n + c.registered, 0) : 0;
  return <section className="analytics-card overflow-hidden" aria-labelledby="map-title">
    <div className="p-5 border-b" style={{ borderColor: 'var(--c-border)' }}>
      <div className="flex flex-wrap justify-between gap-3 items-start"><div><h2 id="map-title" className="font-bold text-lg">User distribution</h2>
        <p className="text-xs mt-1 analytics-muted">Phone-number country · approximate · not the user’s current physical location</p></div>
        <div className="flex rounded-xl p-1 gap-1" style={{ background: 'var(--c-bg)' }}>{MODES.map(m => <button key={m.key} aria-pressed={mode === m.key} className={`analytics-chip ${mode === m.key ? 'analytics-chip-active' : ''}`} onClick={() => setMode(m.key)}>{m.label}</button>)}</div></div>
    </div>
    <div className="grid xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="relative min-w-0 p-3" style={{ background: 'var(--c-bg)' }}>
        <div className="absolute z-10 left-5 top-5 flex flex-col gap-1" aria-label="Map controls">
          <button className="analytics-map-button" aria-label="Zoom in" onClick={() => setView(v => position(v.x, v.y, v.zoom * 1.5))}>+</button>
          <button className="analytics-map-button" aria-label="Zoom out" onClick={() => setView(v => position(v.x, v.y, v.zoom / 1.5))}>−</button>
          <button className="analytics-map-button text-xs" aria-label="Reset map" onClick={() => setView({ x: 500, y: 250, zoom: 1 })}>↺</button>
        </div>
        <div className="min-h-[270px] sm:min-h-[340px] grid items-center">
          {failed ? <p role="status" className="text-center text-sm analytics-muted">Map outlines could not load. Country statistics remain available in the table.</p> : !outlines ? <p className="text-center analytics-muted">Loading map…</p> :
            <svg ref={svg} viewBox={`${view.x - 500 / view.zoom} ${view.y - 250 / view.zoom} ${1000 / view.zoom} ${500 / view.zoom}`} className="w-full max-h-[430px]" style={{ touchAction: 'pan-y', cursor: view.zoom > 1 ? 'grab' : 'default' }} role="group" aria-label="Interactive country map. Select a country, or use the searchable country table."
              onPointerDown={e => { if (e.button !== 0) return; drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; }}
              onPointerMove={e => {
                const d = drag.current;
                if (!d || view.zoom === 1 || e.pointerType === 'touch') return;
                if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 5) return;
                d.moved = true;
                const rect = svg.current!.getBoundingClientRect();
                setView(position(d.vx - (e.clientX - d.x) * 1000 / (rect.width * view.zoom), d.vy - (e.clientY - d.y) * 500 / (rect.height * view.zoom), view.zoom));
              }}
              onPointerUp={() => { const d = drag.current; setTimeout(() => { if (drag.current === d) drag.current = null; }, 0); }}
              onPointerLeave={() => { drag.current = null; }}>
              {outlines.map(o => { const row = byIso.get(o.iso); const value = row ? row[mode] : mode === 'online' && data.onlineUnknown === null ? null : 0; return <path key={o.iso} d={o.path} fill={color(value)} fillRule="evenodd" stroke={selected === o.iso ? '#f59e0b' : 'var(--c-card)'} strokeWidth={selected === o.iso ? 2 : 0.5} vectorEffect="non-scaling-stroke"
                role="button" tabIndex={0} aria-label={`${row?.name ?? o.name}: ${fmt(value)} ${MODES.find(m => m.key === mode)!.label}`}
                onClick={() => { if (!drag.current?.moved) setSelected(o.iso); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(o.iso); } }}>
                <title>{row?.name ?? o.name}: {fmt(value)}</title></path>; })}
              {outlines.filter(o => (byIso.get(o.iso)?.[mode] ?? 0) > 0).map(o => <circle key={`pin-${o.iso}`} cx={o.x} cy={o.y} r={Math.max(3.5, Math.min(10, 3 + Math.sqrt(byIso.get(o.iso)![mode] ?? 0))) / Math.sqrt(view.zoom)} fill={mode === 'online' ? '#22c55e' : '#0c4a6e'} stroke="#fff" strokeWidth={1 / view.zoom} className="cursor-pointer" onClick={() => { if (!drag.current?.moved) setSelected(o.iso); }} aria-hidden="true" />)}
            </svg>}
        </div>
        <div className="flex justify-between gap-2 items-end text-[10px] analytics-muted px-2"><div><div className="flex gap-2 items-center"><span className="w-16 h-2 rounded-full" style={{ background: 'linear-gradient(90deg, #dce8ef, #117eae)' }} />Fewer → more</div><p className="mt-1">Drag to pan after zooming. Use the table for small territories.</p></div>
          <a href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank" rel="noreferrer" className="underline">Natural Earth · public domain</a></div>
        {unmapped > 0 && <p className="text-[10px] analytics-muted px-2 mt-2">{fmt(unmapped)} registered users belong to countries/territories without an outline at this map scale; all are included in the table.</p>}
      </div>
      <aside className="p-4 border-l min-w-0" style={{ borderColor: 'var(--c-border)' }} aria-label="Country statistics">
        {selectedName && <div className="rounded-xl p-3 mb-4" style={{ background: 'var(--c-bg)' }}><div className="flex justify-between items-start gap-2"><strong>{selectedName}</strong><button aria-label="Clear selected country" onClick={() => setSelected(null)}>×</button></div><div className="grid grid-cols-3 gap-2 mt-3 text-[10px] analytics-muted">{MODES.map(m => <div key={m.key}>{m.label}<strong className="block text-base analytics-text mt-1">{fmt(selectedRow ? selectedRow[m.key] : m.key === 'online' && data.onlineUnknown === null ? null : 0)}</strong></div>)}</div></div>}
        <label className="text-xs font-semibold block">Find a country<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or country code" className="analytics-input w-full mt-2" /></label>
        <div className="overflow-y-auto max-h-64 mt-3"><table className="text-xs w-full"><caption className="sr-only">Countries sorted by {mode}</caption><thead className="analytics-muted"><tr><th className="text-left pb-2">Country</th><th className="text-right pb-2">{MODES.find(m => m.key === mode)!.label}</th></tr></thead><tbody>{rows.map(row => <tr key={row.iso} className="border-t" style={{ borderColor: 'var(--c-border)' }}><td className="py-2"><button className={`text-left hover:underline ${selected === row.iso ? 'font-bold' : ''}`} onClick={() => focus(row.iso)}>{row.name} <span className="analytics-muted text-[10px]">{row.iso}</span></button></td><td className="text-right tabular-nums">{fmt(row[mode])}</td></tr>)}</tbody></table>{!rows.length && <p className="text-xs analytics-muted py-4">No matching countries.</p>}</div>
      </aside>
    </div>
    <div className="flex flex-wrap justify-between gap-2 border-t px-5 py-3 text-[11px] analytics-muted" style={{ borderColor: 'var(--c-border)' }}>
      <span>Country coverage: {fmt(data.total - data.unknown)} / {fmt(data.total)} accounts · Unknown: {fmt(data.unknown)} · Active now, country unknown: {fmt(data.onlineUnknown)}</span>
      <span>Registration / 24h snapshot {time(data.registeredAt)} UTC · Presence {time(data.presenceAt)} UTC</span>
    </div>
  </section>;
}
