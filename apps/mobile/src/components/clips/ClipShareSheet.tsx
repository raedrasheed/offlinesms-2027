import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, ActivityIndicator, StyleSheet, Share, Clipboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { clipLink, shareClip, type ClipItem } from '../../lib/clips';
import { auth } from '../../lib/firebase';
import { isClipTermsCancellation } from '../../lib/clipTerms';
import { useClipsCopy } from '../../lib/clipsCopy';
import { clipOperationId } from '../../lib/clipSocialModel';
import { useClipDestinations } from '../../hooks/useClipDestinations';
import ClipSheet from './ClipSheet';

export default function ClipShareSheet({ visible, clip, onClose, onShared }: {
  visible: boolean; clip: ClipItem; onClose: () => void; onShared?: () => void;
}) {
  const { c, rtl } = useClipsCopy();
  const { rows, loading } = useClipDestinations(visible);
  const [query, setQuery] = useState(''), [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const operations = useRef<Record<string, string>>({}), sending = useRef(false), epoch = useRef(0);
  useEffect(() => { epoch.current++; setSelected([]); setQuery(''); setError(''); setMessage(''); setBusy(false); sending.current = false; operations.current = {}; return () => { epoch.current++; }; }, [visible, clip.id, auth.currentUser?.uid]);
  const filtered = rows.filter(row => row.label.toLowerCase().includes(query.trim().toLowerCase()));
  function toggle(id: string) {
    if (busy) return;
    setSelected(old => old.includes(id) ? old.filter(value => value !== id) : old.length < 10 ? [...old, id] : old);
  }
  async function send() {
    if (sending.current || !selected.length) return;
    sending.current = true; setBusy(true); setError(''); setMessage('');
    const generation = epoch.current, uid = auth.currentUser?.uid, failed: string[] = [];
    let succeeded = 0, cancelled = false;
    for (const [index, conversationId] of selected.entries()) {
      if (generation !== epoch.current || uid !== auth.currentUser?.uid) return;
      operations.current[conversationId] ??= clipOperationId();
      try {
        await shareClip({ clipId: clip.id, conversationId, clientId: operations.current[conversationId] });
        succeeded++; if (generation === epoch.current) onShared?.();
      } catch (failure) { if (isClipTermsCancellation(failure)) { cancelled = true; failed.push(...selected.slice(index)); break; } failed.push(conversationId); }
    }
    if (generation !== epoch.current) return;
    setSelected(failed); setBusy(false); sending.current = false;
    if (succeeded) setMessage(c(`Sent to ${succeeded} conversations.`, `تم الإرسال إلى ${succeeded} محادثات.`));
    if (failed.length && !cancelled) setError(c('Some shares could not be confirmed. Retry only the selected conversations; confirmed sends will not be repeated.', 'تعذّر تأكيد بعض المشاركات. أعد المحاولة للمحادثات المحددة فقط؛ لن تتكرر الرسائل المؤكدة.'));
  }
  function copy() {
    Clipboard.setString(clipLink(clip.id)); setMessage(c('Link copied.', 'تم نسخ الرابط.'));
  }
  async function external() {
    try { await Share.share({ message: clipLink(clip.id), url: clipLink(clip.id) }); }
    catch { setError(c('Could not open sharing.', 'تعذّر فتح المشاركة.')); }
  }
  return <ClipSheet visible={visible} title={c('Share clip', 'مشاركة المقطع')} onClose={onClose}>
    <View style={[s.banner, rtl && { flexDirection: 'row-reverse' }]}><Ionicons name="chatbubbles-outline" size={27} color="#1F7BA8" /><View style={{ flex: 1 }}><Text style={s.bannerTitle}>{c('Inside OfflineSMS', 'داخل OfflineSMS')}</Text><Text style={s.hint}>{c('Choose up to 10 conversations.', 'اختر حتى 10 محادثات.')}</Text></View></View>
    <TextInput value={query} onChangeText={setQuery} style={[s.search, { textAlign: rtl ? 'right' : 'left' }]} placeholder={c('Search chats and groups', 'ابحث عن محادثة أو مجموعة')} placeholderTextColor="#7F8C98" />
    <ScrollView style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled">
      {loading ? <ActivityIndicator color="#1F7BA8" style={{ margin: 22 }} /> : null}
      {!loading && !filtered.length ? <Text style={s.empty}>{c('No conversations found.', 'لا توجد محادثات مطابقة.')}</Text> : null}
      {filtered.map(row => <Pressable key={row.id} disabled={busy} onPress={() => toggle(row.id)} style={[s.destination, selected.includes(row.id) && { backgroundColor: '#E3F1FA' }, rtl && { flexDirection: 'row-reverse' }]} accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(row.id) }}>
        <View style={s.avatar}><Ionicons name={row.type === 'group' ? 'people-outline' : 'person-outline'} size={21} color="#1F7BA8" /></View>
        <Text numberOfLines={1} style={[s.label, { textAlign: rtl ? 'right' : 'left' }]}>{row.label}</Text>
        <Ionicons name={selected.includes(row.id) ? 'checkbox' : 'square-outline'} size={23} color={selected.includes(row.id) ? '#1F7BA8' : '#A6B1BB'} />
      </Pressable>)}
    </ScrollView>
    {error ? <Text style={s.error}>{error}</Text> : null}{message ? <Text style={s.success}>{message}</Text> : null}
    <Pressable disabled={busy || !selected.length} onPress={() => void send()} style={[s.send, (busy || !selected.length) && { opacity: 0.5 }]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={s.sendText}>{c('Send', 'إرسال')}{selected.length ? ` (${selected.length})` : ''}</Text>}</Pressable>
    {clip.audience === 'public' && !clip.author.privateAccount ? <View style={s.external}><Pressable style={s.externalItem} onPress={copy}><Ionicons name="link-outline" size={24} color="#182330" /><Text style={s.externalText}>{c('Copy link', 'نسخ الرابط')}</Text></Pressable><Pressable style={s.externalItem} onPress={() => void external()}><Ionicons name="share-social-outline" size={24} color="#182330" /><Text style={s.externalText}>{c('Share externally', 'مشاركة خارجية')}</Text></Pressable></View> : null}
    <Text style={s.privacy}>🔒 {c('Sharing never changes who can watch this clip.', 'تبقى خصوصية المقطع كما هي عند مشاركته.')}</Text>
  </ClipSheet>;
}
const s = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E3F1FA', borderRadius: 17, padding: 14, gap: 12 }, bannerTitle: { fontSize: 16, fontWeight: '800', color: '#182330' }, hint: { fontSize: 12, color: '#657586', marginTop: 4 }, search: { color: '#182330', paddingHorizontal: 15, paddingVertical: 11, backgroundColor: '#F0F4F7', borderRadius: 13, marginVertical: 14 },
  destination: { flexDirection: 'row', alignItems: 'center', padding: 9, gap: 12, borderRadius: 13, marginBottom: 5 }, avatar: { width: 39, height: 39, borderRadius: 20, backgroundColor: '#EFF6FA', alignItems: 'center', justifyContent: 'center' }, label: { flex: 1, color: '#182330', fontSize: 15, fontWeight: '700' }, send: { marginTop: 14, backgroundColor: '#1F7BA8', padding: 13, alignItems: 'center', borderRadius: 14 }, sendText: { color: '#fff', fontWeight: '800', fontSize: 16 }, empty: { textAlign: 'center', color: '#708091', padding: 22 }, error: { marginTop: 12, color: '#A93442', fontSize: 13, lineHeight: 19 }, success: { marginTop: 12, color: '#1C7D51', textAlign: 'center' }, external: { flexDirection: 'row', justifyContent: 'space-evenly', paddingVertical: 17, borderBottomWidth: 1, borderBottomColor: '#E5EBF1' }, externalItem: { alignItems: 'center', gap: 8 }, externalText: { color: '#182330', fontSize: 13 }, privacy: { textAlign: 'center', color: '#718091', fontSize: 12, marginVertical: 12 },
});
