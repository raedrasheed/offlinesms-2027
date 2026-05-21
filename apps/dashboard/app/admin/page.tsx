import Topbar from '@/components/Topbar';
import { Users, MessageCircle, Send, Coins } from 'lucide-react';

const stats = [
  { label: 'Active users (24h)',  value: '12,418', delta: '+8.2%',  c: 'text-emerald-600', icon: Users },
  { label: 'Messages sent',       value: '482,193',delta: '+12.4%', c: 'text-emerald-600', icon: MessageCircle },
  { label: 'SMS escalated (24h)', value: '1,824',  delta: '-3.1%',  c: 'text-amber-600',   icon: Send },
  { label: 'Points earned',       value: '92,308', delta: '+5.6%',  c: 'text-emerald-600', icon: Coins },
];

export default function AdminOverview() {
  return (
    <>
      <Topbar title="Overview" subtitle="Yesterday vs the prior 24 hours" />
      <div className="p-7 grid grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className="bg-white rounded-2xl shadow-sh1 p-5">
            <div className="flex items-center gap-2 text-ink-500 text-xs font-bold uppercase tracking-wider">
              <s.icon size={14}/> {s.label}
            </div>
            <div className="font-mono text-3xl font-extrabold mt-2 tracking-tight">{s.value}</div>
            <div className={'text-xs font-bold mt-1 ' + s.c}>{s.delta}</div>
          </div>
        ))}
      </div>

      <div className="px-7 grid grid-cols-3 gap-4 mt-3">
        <div className="col-span-2 bg-white rounded-2xl shadow-sh1 p-5">
          <div className="text-sm font-extrabold tracking-tight">Messages over time</div>
          <p className="text-xs text-ink-500 mt-0.5">Last 7 days</p>
          <div className="h-48 bg-surface3 rounded-xl mt-4 grid place-items-center text-xs text-ink-500">
            [chart placeholder — wire with recharts/visx]
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sh1 p-5">
          <div className="text-sm font-extrabold tracking-tight">SMS gateway health</div>
          <div className="space-y-3 mt-4 text-sm">
            <Row k="Status" v={<span className="text-emerald-600 font-semibold">● Active</span>}/>
            <Row k="Delivery delay" v="1.8s"/>
            <Row k="Daily limit" v="2,400"/>
            <Row k="Sent today" v="312"/>
          </div>
        </div>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between text-ink-700"><span className="text-ink-500">{k}</span><span className="font-semibold">{v}</span></div>;
}
