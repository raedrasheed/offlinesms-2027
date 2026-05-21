import Topbar from '@/components/Topbar';

export default function PointsAdmin() {
  return (
    <>
      <Topbar title="Points" subtitle="Wallets · packages · transactions · refunds"/>
      <div className="p-7 grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-sh1 p-5 col-span-2">
          <div className="text-xs font-bold text-ink-500 tracking-wider">ORG WALLET</div>
          <div className="font-mono text-3xl font-extrabold mt-2">148,200 <span className="text-base text-ink-500 font-semibold">pts</span></div>
          <div className="flex gap-2 mt-3">
            <span className="bg-primary text-white text-[10px] font-bold rounded-full px-2.5 py-0.5">↑ 12,800 this week</span>
            <span className="bg-surface3 text-ink-600 text-[10px] font-bold rounded-full px-2.5 py-0.5">14,392 spent</span>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sh1 p-5">
          <div className="text-sm font-extrabold">Refund queue</div>
          <div className="text-3xl font-mono font-extrabold mt-2">7</div>
          <div className="text-xs text-ink-500">pending undelivered confirmations</div>
        </div>
      </div>

      <div className="p-7 pt-3 grid grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl shadow-sh1 p-5">
          <div className="text-sm font-extrabold">Packages</div>
          <ul className="mt-3 divide-y divide-ink-100 text-sm">
            <li className="flex justify-between py-2"><span>500 pts · €5</span><span className="text-ink-500">12 sold this month</span></li>
            <li className="flex justify-between py-2"><span>1,000 pts · €10 <span className="text-emerald-600 text-xs">+50 bonus</span></span><span className="text-ink-500">48 sold</span></li>
            <li className="flex justify-between py-2"><span>5,000 pts · €45 <span className="text-amber-600 text-xs">BEST VALUE</span></span><span className="text-ink-500">6 sold</span></li>
          </ul>
        </div>
        <div className="bg-white rounded-2xl shadow-sh1 p-5">
          <div className="text-sm font-extrabold">SMS cost rules</div>
          <ul className="mt-3 text-sm space-y-2">
            <li className="flex justify-between"><span className="text-ink-500">Default pts / segment</span><span className="font-semibold font-mono">1.5</span></li>
            <li className="flex justify-between"><span className="text-ink-500">Min points / SMS</span><span className="font-semibold font-mono">2</span></li>
            <li className="flex justify-between"><span className="text-ink-500">Rounding</span><span className="font-semibold">Round up</span></li>
            <li className="flex justify-between"><span className="text-ink-500">Points expire after</span><span className="font-semibold">12 months</span></li>
          </ul>
        </div>
      </div>
    </>
  );
}
