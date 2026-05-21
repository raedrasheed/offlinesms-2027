import Topbar from '@/components/Topbar';

export default function SmsAdmin() {
  return (
    <>
      <Topbar title="SMS Gateway" subtitle="OfflineSMS Gateway · routing · webhooks · logs"/>
      <div className="p-7 grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-sh1 p-5 col-span-2">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 grid place-items-center font-bold">✓</span>
            <div className="flex-1">
              <div className="font-extrabold">OfflineSMS Gateway</div>
              <div className="text-xs text-emerald-600 font-semibold">● Connected · last test 2m ago</div>
            </div>
            <button className="px-3 py-1.5 rounded-lg bg-primary-light text-primary text-xs font-bold">Send test SMS</button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <Row k="Sender ID" v="OFLINSMS"/>
            <Row k="Daily limit" v="2,400 SMS"/>
            <Row k="API key" v="•••• 4f92"/>
            <Row k="Webhook URL" v="…/dlr"/>
            <Row k="Balance" v="1,250,000 pts"/>
            <Row k="Average delay" v="1.8s"/>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sh1 p-5">
          <div className="text-sm font-extrabold">Policy</div>
          <div className="text-xs text-ink-500 mt-0.5">Who can escalate, cooldown, limits</div>
          <ul className="mt-4 text-sm space-y-2">
            <li className="flex justify-between"><span className="text-ink-500">Allow escalation</span> <span className="font-semibold">Sender + admins</span></li>
            <li className="flex justify-between"><span className="text-ink-500">Suggest after</span> <span className="font-semibold">30 min</span></li>
            <li className="flex justify-between"><span className="text-ink-500">Max SMS / message</span> <span className="font-semibold">200</span></li>
            <li className="flex justify-between"><span className="text-ink-500">Block in disappearing</span> <span className="font-semibold text-emerald-600">ON</span></li>
          </ul>
        </div>
      </div>

      <div className="px-7 mt-3">
        <div className="bg-white rounded-2xl shadow-sh1 p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-extrabold">Recent SMS batches</div>
            <button className="text-xs text-primary font-bold">Export →</button>
          </div>
          {/* TODO: list /smsBatches ordered by createdAt desc */}
          <div className="text-xs text-ink-500 mt-3">List the latest /smsBatches with status + delivery rate — TODO.</div>
        </div>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between text-ink-700"><span className="text-ink-500">{k}</span><span className="font-semibold font-mono">{v}</span></div>;
}
