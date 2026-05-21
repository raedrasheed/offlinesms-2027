// Users admin — live Firestore list
'use client';
import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Topbar from '@/components/Topbar';
import { Ban, ShieldCheck, MoreVertical } from 'lucide-react';

type User = { id: string; displayName?: string; phoneNumber?: string; createdAt?: any; status?: string; admin?: boolean };

export default function UsersAdmin() {
  const [rows, setRows] = useState<User[]>([]);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(100));
    return onSnapshot(q, snap => {
      setRows(snap.docs.map(d => ({ id: d.id, ...d.data() }) as User));
      setBusy(false);
    });
  }, []);
  return (
    <>
      <Topbar title="Users" subtitle={`${rows.length} loaded · most recent first`}/>
      <div className="p-7">
        <div className="bg-white rounded-2xl shadow-sh1 overflow-hidden">
          <div className="grid grid-cols-[1fr,1fr,1fr,120px,120px,40px] gap-4 px-5 py-3 bg-surface3 text-[10px] font-bold text-ink-700 uppercase tracking-wider">
            <div>User</div><div>Phone</div><div>Joined</div><div>Status</div><div>Role</div><div/>
          </div>
          {busy && <div className="p-8 text-center text-sm text-ink-500">Loading…</div>}
          {!busy && rows.length === 0 && <div className="p-8 text-center text-sm text-ink-500">No users yet — run the seed script.</div>}
          {rows.map(u => (
            <div key={u.id} className="grid grid-cols-[1fr,1fr,1fr,120px,120px,40px] gap-4 px-5 py-3 items-center border-t border-ink-100 text-sm">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full bg-primary"/>
                <div className="min-w-0">
                  <div className="font-bold truncate">{u.displayName ?? 'Unknown'}</div>
                  <div className="text-[10px] text-ink-500 font-mono truncate">{u.id}</div>
                </div>
              </div>
              <div className="font-mono text-xs">{u.phoneNumber ?? '—'}</div>
              <div className="font-mono text-xs text-ink-500">
                {u.createdAt?.toDate?.()?.toLocaleDateString() ?? '—'}
              </div>
              <div>
                <span className={'text-[10px] font-bold rounded-full px-2 py-0.5 ' + (u.status === 'blocked' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700')}>
                  {u.status === 'blocked' ? <><Ban size={10} className="inline -mt-px"/> BLOCKED</> : '● ACTIVE'}
                </span>
              </div>
              <div>
                {u.admin ? <span className="text-[10px] font-bold bg-primary-light text-primary-dark rounded-full px-2 py-0.5"><ShieldCheck size={10} className="inline -mt-px"/> ADMIN</span>
                         : <span className="text-[10px] text-ink-500">Member</span>}
              </div>
              <button className="text-ink-400 hover:text-ink-700"><MoreVertical size={16}/></button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
