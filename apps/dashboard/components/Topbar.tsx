import { Search, Bell } from 'lucide-react';

export default function Topbar({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="bg-white border-b border-ink-100 px-7 py-4 flex items-center gap-4">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="text-xs text-ink-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex-1"/>
      <div className="flex items-center gap-2 bg-surface3 rounded-lg px-3 py-2 text-ink-500 w-72">
        <Search size={14}/>
        <input placeholder="Search users, chats, messages…" className="bg-transparent text-sm flex-1 outline-none"/>
        <span className="font-mono text-[10px] bg-white border border-ink-200 rounded px-1.5 py-0.5">⌘K</span>
      </div>
      <button className="w-9 h-9 rounded-lg bg-surface3 grid place-items-center text-ink-700"><Bell size={16}/></button>
      <div className="w-9 h-9 rounded-full bg-primary"/>
    </header>
  );
}
