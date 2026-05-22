'use client';

import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie,
} from 'recharts';

const msgData = [
  { day: 'Mon', msgs: 22000 },
  { day: 'Tue', msgs: 28000 },
  { day: 'Wed', msgs: 31000 },
  { day: 'Thu', msgs: 18000 },
  { day: 'Fri', msgs: 42000 },
  { day: 'Sat', msgs: 35000 },
  { day: 'Sun', msgs: 29000 },
];

const deliveryData = [
  { name: 'Delivered', value: 62, color: '#22C55E' },
  { name: 'Failed',    value: 11, color: '#EF4444' },
  { name: 'Pending',   value: 22, color: '#F59E0B' },
  { name: 'Others',   value: 4,  color: '#475569' },
];

const pointsData = [
  { day: 'Mon', pts: 12000 },
  { day: 'Tue', pts: 19000 },
  { day: 'Wed', pts: 15000 },
  { day: 'Thu', pts: 24000 },
  { day: 'Fri', pts: 31000 },
  { day: 'Sat', pts: 28000 },
  { day: 'Sun', pts: 20000 },
];

const CARD_BG = 'var(--c-card)';
const BORDER  = 'var(--c-border)';

export function MessagesChart() {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] font-semibold" style={{ color: 'var(--c-text)' }}>Messages over time</p>
          <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>Last 7 days</p>
        </div>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: '#0A2035', color: '#5BB6DE' }}>
          +12% vs last week
        </span>
      </div>
      <ResponsiveContainer width="100%" height={130}>
        <AreaChart data={msgData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="msgGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#1F7BA8" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#1F7BA8" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="day" tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={{ background: 'var(--c-bg)', border: '1px solid var(--c-border)', borderRadius: 8, fontSize: 12, color: 'var(--c-text)' }}
            formatter={(v: number) => [`${v.toLocaleString()} msgs`, '']}
            labelStyle={{ color: 'var(--c-text-2)' }}
          />
          <Area type="monotone" dataKey="msgs" stroke="#1F7BA8" strokeWidth={2} fill="url(#msgGrad)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DeliveryChart() {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
      <div>
        <p className="text-[13px] font-semibold" style={{ color: 'var(--c-text)' }}>SMS delivery rate</p>
        <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>Last 7d</p>
      </div>
      <div className="flex items-center gap-3">
        <ResponsiveContainer width={110} height={110}>
          <PieChart>
            <Pie data={deliveryData} cx="50%" cy="50%" innerRadius={32} outerRadius={50} dataKey="value" strokeWidth={0}>
              {deliveryData.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="flex flex-col gap-1.5 flex-1">
          {deliveryData.map(d => (
            <div key={d.name} className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                <span style={{ color: 'var(--c-text-2)' }}>{d.name}</span>
              </div>
              <span className="font-semibold" style={{ color: 'var(--c-text)' }}>{d.value}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PointsChart() {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] font-semibold" style={{ color: 'var(--c-text)' }}>Points usage</p>
          <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>Last 7d</p>
        </div>
        <span className="text-[11px] font-semibold" style={{ color: '#EF4444' }}>-4% last 7d</span>
      </div>
      <ResponsiveContainer width="100%" height={110}>
        <BarChart data={pointsData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <XAxis dataKey="day" tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={{ background: 'var(--c-bg)', border: '1px solid var(--c-border)', borderRadius: 8, fontSize: 12, color: 'var(--c-text)' }}
            formatter={(v: number) => [`${v.toLocaleString()} pts`, '']}
            labelStyle={{ color: 'var(--c-text-2)' }}
          />
          <Bar dataKey="pts" fill="#1F7BA8" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
