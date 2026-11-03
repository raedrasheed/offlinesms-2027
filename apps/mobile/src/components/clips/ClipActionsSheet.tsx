import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Alert, ActivityIndicator, TextInput, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { auth } from '../../lib/firebase';
import { isClipTermsCancellation } from '../../lib/clipTerms';
import { blockUser } from '../../lib/blocks';
import { deleteClip, getClipPlayback, reportClip, setClipInteraction, updateClip, type ClipAudience, type ClipItem, type ClipReportReason } from '../../lib/clips';
import { useClipsCopy } from '../../lib/clipsCopy';
import { useClipDestinations } from '../../hooks/useClipDestinations';
import ClipSheet from './ClipSheet';

export default function ClipActionsSheet({ visible, clip, onClose, onRemoved, onHidden, onUpdated }: {
  visible: boolean; clip: ClipItem; onClose: () => void; onRemoved?: () => void; onHidden?: () => void; onUpdated?: (clip: ClipItem) => void;
}) {
  const { c, rtl } = useClipsCopy();
  const owner = clip.ownerUid === auth.currentUser?.uid;
  const [mode, setMode] = useState<'actions' | 'report' | 'edit'>('actions');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const epoch = useRef(0), acting = useRef(false);
  const [reason, setReason] = useState<ClipReportReason>('other'), [details, setDetails] = useState('');
  const [caption, setCaption] = useState(clip.caption), [audience, setAudience] = useState<ClipAudience>(clip.audience);
  const [groupId, setGroupId] = useState(clip.groupId), [comments, setComments] = useState(clip.allowComments), [download, setDownload] = useState(clip.allowDownload);
  const destinations = useClipDestinations(visible && mode === 'edit' && audience === 'group');
  useEffect(() => { epoch.current++; acting.current = false; setMode('actions'); setError(''); setBusy(false); setDetails(''); setCaption(clip.caption); setAudience(clip.audience); setGroupId(clip.groupId); setComments(clip.allowComments); setDownload(clip.allowDownload); return () => { epoch.current++; }; }, [visible, clip.id, auth.currentUser?.uid]);
  async function perform(action: () => Promise<unknown>, done?: () => void) {
    if (acting.current) return;
    acting.current = true; const generation = epoch.current;
    setBusy(true); setError('');
    try { await action(); if (generation === epoch.current) done?.(); }
    catch (failure) { if (generation === epoch.current && !isClipTermsCancellation(failure)) setError(c('Could not complete this action. Please try again.', 'تعذّر تنفيذ العملية. حاول مجددًا.')); }
    finally { if (generation === epoch.current) { acting.current = false; setBusy(false); } }
  }
  function remove() {
    const generation = epoch.current;
    Alert.alert(c('Delete this clip?', 'حذف هذا المقطع؟'), c('The clip will no longer be available to viewers.', 'لن يعود المقطع متاحًا للمشاهدين.'), [
      { text: c('Cancel', 'إلغاء'), style: 'cancel' },
      { text: c('Delete', 'حذف'), style: 'destructive', onPress: () => { if (generation === epoch.current) void perform(() => deleteClip(clip.id), () => { onRemoved?.(); onClose(); }); } },
    ]);
  }
  function block() {
    const uid = auth.currentUser?.uid, generation = epoch.current;
    if (!uid) return;
    Alert.alert(c('Block this creator?', 'حظر هذا الناشر؟'), c('This also blocks direct contact in OfflineSMS.', 'يشمل الحظر التواصل المباشر في OfflineSMS.'), [
      { text: c('Cancel', 'إلغاء'), style: 'cancel' },
      { text: c('Block', 'حظر'), style: 'destructive', onPress: () => { if (generation === epoch.current) void perform(() => blockUser(uid, clip.ownerUid), () => { onHidden?.(); onClose(); }); } },
    ]);
  }
  async function saveVideo() {
    const uid = auth.currentUser?.uid, generation = epoch.current;
    await perform(async () => {
      const lease = await getClipPlayback({ clipId: clip.id, quality: 'standard', download: true });
      if (!lease.url || !(await Sharing.isAvailableAsync())) throw new Error('download-unavailable');
      if (!FileSystem.cacheDirectory) throw new Error('download-unavailable');
      const folder = `${FileSystem.cacheDirectory}clip-downloads/${encodeURIComponent(uid ?? '')}/`;
      await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
      const target = `${folder}${clip.id.replace(/[^a-zA-Z0-9_-]/g, '')}.mp4`;
      try {
        const result = await FileSystem.downloadAsync(lease.url, target);
        if (result.status !== 200 || auth.currentUser?.uid !== uid || generation !== epoch.current) throw new Error('download-failed');
        await Sharing.shareAsync(result.uri, { mimeType: 'video/mp4', UTI: 'public.mpeg-4', dialogTitle: c('Save video', 'حفظ الفيديو') });
      } finally { await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {}); }
    });
  }
  async function saveSettings() {
    const generation = epoch.current;
    await perform(async () => {
      const result = await updateClip({ clipId: clip.id, caption: caption.trim(), audience, groupId: audience === 'group' ? groupId : null, allowComments: comments, allowDownload: download });
      if (generation === epoch.current) { onUpdated?.(result); onClose(); }
    });
  }
  const reasons: Array<[ClipReportReason, string, string]> = [['spam', 'Spam', 'محتوى مزعج'], ['abuse', 'Harassment or abuse', 'إساءة أو مضايقة'], ['sexual', 'Sexual content', 'محتوى جنسي'], ['violence', 'Violence', 'عنف'], ['copyright', 'Copyright', 'حقوق نشر'], ['other', 'Other', 'سبب آخر']];
  const audiences: Array<[ClipAudience, string, string]> = [['public', 'Public', 'عام'], ['followers', 'Approved followers', 'المتابعون المقبولون'], ['group', 'One group', 'مجموعة محددة'], ['private', 'Only me', 'أنا فقط']];
  function action(icon: keyof typeof Ionicons.glyphMap, text: string, onPress: () => void, danger = false) {
    return <Pressable key={text} disabled={busy} onPress={onPress} style={[s.action, rtl && { flexDirection: 'row-reverse' }]}><Ionicons name={icon} size={22} color={danger ? '#BA3B4C' : '#1F7BA8'} /><Text style={[s.actionText, danger && { color: '#BA3B4C' }]}>{text}</Text></Pressable>;
  }
  return <ClipSheet visible={visible} title={mode === 'report' ? c('Report clip', 'الإبلاغ عن المقطع') : mode === 'edit' ? c('Publish settings', 'إعدادات النشر') : c('Clip options', 'خيارات المقطع')} onClose={onClose}>
    <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }}>
      {mode === 'actions' ? <>
        {owner ? <>{action('create-outline', c('Edit caption and privacy', 'تعديل الوصف والخصوصية'), () => setMode('edit'))}{action('trash-outline', c('Delete clip', 'حذف المقطع'), remove, true)}</> : <>
          {action('eye-off-outline', c('Not interested', 'غير مهتم'), () => void perform(() => setClipInteraction(clip.id, 'hide', true), () => { onHidden?.(); onClose(); }))}
          {action('flag-outline', c('Report', 'إبلاغ'), () => setMode('report'))}
          {action('ban-outline', c('Block creator', 'حظر الناشر'), block, true)}
        </>}
        {clip.allowDownload && clip.status === 'published' ? action('download-outline', c('Download / save video', 'تنزيل / حفظ الفيديو'), () => void saveVideo()) : null}
      </> : null}
      {mode === 'report' ? <>
        {reasons.map(([key, en, ar]) => <Pressable key={key} disabled={busy} onPress={() => setReason(key)} style={[s.action, rtl && { flexDirection: 'row-reverse' }]}><Ionicons name={reason === key ? 'radio-button-on' : 'radio-button-off'} color="#1F7BA8" size={22} /><Text style={s.actionText}>{c(en, ar)}</Text></Pressable>)}
        <TextInput value={details} onChangeText={setDetails} maxLength={1000} multiline placeholder={c('Optional details', 'تفاصيل اختيارية')} placeholderTextColor="#7A8794" style={[s.input, { minHeight: 85, textAlign: rtl ? 'right' : 'left' }]} />
        <Pressable disabled={busy} style={s.primary} onPress={() => void perform(() => reportClip({ clipId: clip.id, reason, details: details.trim() }), () => { onClose(); Alert.alert(c('Report received', 'تم استلام البلاغ'), c('Our moderators will review it.', 'ستراجعه إدارة المحتوى.')); })}><Text style={s.primaryText}>{c('Send report', 'إرسال البلاغ')}</Text></Pressable>
      </> : null}
      {mode === 'edit' ? <>
        <TextInput value={caption} onChangeText={setCaption} multiline maxLength={2000} style={[s.input, { minHeight: 90, textAlign: rtl ? 'right' : 'left' }]} accessibilityLabel={c('Caption', 'الوصف')} />
        <Text style={s.label}>{c('Who can watch?', 'من يمكنه المشاهدة؟')}</Text>
        {audiences.map(([key, en, ar]) => <Pressable key={key} disabled={busy} onPress={() => setAudience(key)} style={[s.choice, audience === key && s.selected]}><Text style={s.actionText}>{c(en, ar)}</Text><Ionicons name={audience === key ? 'checkmark-circle' : 'ellipse-outline'} color="#1F7BA8" size={21} /></Pressable>)}
        {audience === 'group' ? destinations.rows.filter(row => row.type === 'group').map(row => <Pressable key={row.id} onPress={() => setGroupId(row.id)} style={[s.choice, groupId === row.id && s.selected]}><Text style={s.actionText}>{row.label}</Text><Ionicons name={groupId === row.id ? 'checkbox' : 'square-outline'} size={20} color="#1F7BA8" /></Pressable>) : null}
        {audience === 'group' && destinations.loading ? <ActivityIndicator color="#1F7BA8" /> : null}
        {audience === 'group' && !destinations.loading && !destinations.rows.some(row => row.type === 'group') ? <Text style={s.hint}>{c('Join or create a group to choose this audience.', 'انضم إلى مجموعة أو أنشئ مجموعة لاختيار هذا الجمهور.')}</Text> : null}
        <View style={s.toggle}><Text style={s.actionText}>{c('Allow comments', 'السماح بالتعليقات')}</Text><Switch value={comments} onValueChange={setComments} disabled={busy} trackColor={{ true: '#1F7BA8' }} /></View>
        <View style={s.toggle}><Text style={s.actionText}>{c('Allow downloads', 'السماح بالتنزيل')}</Text><Switch value={download} onValueChange={setDownload} disabled={busy} trackColor={{ true: '#1F7BA8' }} /></View>
        <Text style={s.hint}>{c('Changing the caption or audience may send this clip for review again.', 'قد يتطلب تغيير الوصف أو الجمهور مراجعة المقطع مجددًا.')}</Text>
        <Pressable disabled={busy || (audience === 'group' && !groupId)} onPress={() => void saveSettings()} style={[s.primary, (busy || (audience === 'group' && !groupId)) && { opacity: 0.5 }]}><Text style={s.primaryText}>{c('Save changes', 'حفظ التغييرات')}</Text></Pressable>
      </> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}{busy ? <ActivityIndicator color="#1F7BA8" style={{ margin: 15 }} /> : null}
      {mode !== 'actions' ? <Pressable disabled={busy} onPress={() => setMode('actions')} style={s.back}><Text style={s.link}>{c('Back', 'رجوع')}</Text></Pressable> : null}
    </ScrollView>
  </ClipSheet>;
}
const s = StyleSheet.create({
  action: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E6ECF2' }, actionText: { color: '#1D2B3A', fontSize: 15, flex: 1 }, input: { backgroundColor: '#F2F6F8', borderRadius: 13, padding: 13, color: '#182330', marginVertical: 12 }, primary: { alignItems: 'center', borderRadius: 13, backgroundColor: '#1F7BA8', padding: 14, marginTop: 14 }, primaryText: { color: '#fff', fontWeight: '800', fontSize: 15 }, error: { color: '#A93442', paddingVertical: 12 }, back: { alignItems: 'center', padding: 14 }, link: { color: '#1F7BA8', fontWeight: '700' }, label: { color: '#182330', fontWeight: '800', marginVertical: 12 }, choice: { flexDirection: 'row', padding: 12, borderRadius: 12, marginBottom: 7, borderWidth: 1, borderColor: '#E1E8EF' }, selected: { backgroundColor: '#E3F1FA', borderColor: '#9BC9E2' }, toggle: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 }, hint: { color: '#7A8794', fontSize: 12, lineHeight: 19, marginVertical: 10 },
});
