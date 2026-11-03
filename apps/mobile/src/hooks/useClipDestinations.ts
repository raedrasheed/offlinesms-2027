import { useEffect, useMemo, useState } from 'react';
import { auth } from '../lib/firebase';
import { subscribeConversations, type Conversation } from '../lib/conversations';
import { useDisplayNames } from '../lib/userProfiles';
import { useClipsCopy } from '../lib/clipsCopy';

export function useClipDestinations(enabled = true) {
  const [rows, setRows] = useState<Conversation[] | null>(null);
  const uid = auth.currentUser?.uid;
  const { c } = useClipsCopy();
  useEffect(() => {
    setRows(null);
    if (!enabled || !uid) return;
    return subscribeConversations(setRows);
  }, [enabled, uid]);
  const peers = useMemo(() => Object.fromEntries((rows ?? []).filter(row => row.type === 'direct')
    .map(row => [row.id, (row.participantUids ?? row.memberIds ?? []).find(id => id !== uid) ?? ''])), [rows, uid]);
  const nameFor = useDisplayNames(Object.values(peers).filter(Boolean));
  return { loading: enabled && rows === null, rows: (rows ?? []).filter(row => row.status !== 'disabled' && row.status !== 'locked')
    .map(row => ({ ...row, label: row.type === 'group' ? row.name || c('Group', 'مجموعة') : nameFor(peers[row.id]) || c('Conversation', 'محادثة') })) };
}
