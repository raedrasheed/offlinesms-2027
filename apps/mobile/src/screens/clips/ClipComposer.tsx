import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, Switch, Alert, KeyboardAvoidingView, Platform, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { Audio, Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import NetInfo from '@react-native-community/netinfo';
import { auth } from '../../lib/firebase';
import { acceptClipsTerms, getClipsConfig, type ClipAudience, type ClipsConfig } from '../../lib/clips';
import { useClipsCopy } from '../../lib/clipsCopy';
import { createClipDraft, getClipDraft, saveClipDraft, type ClipDraft } from '../../lib/clipDrafts';
import { startClipUpload, type ClipUploadHandle } from '../../lib/clipUploads';
import { trimDraftRange } from '../../lib/clipSocialModel';
import { CLIPS_COMMUNITY_TERMS, isClipTermsCancellation } from '../../lib/clipTerms';
import { useClipDestinations } from '../../hooks/useClipDestinations';

const INITIAL_MAX_SECONDS = 60;
export default function ClipComposer({ route, navigation }: any) {
  const { c, rtl } = useClipsCopy();
  const insets = useSafeAreaInsets(), focused = useIsFocused();
  const [draft, setDraft] = useState<ClipDraft | null>(null);
  const [config, setConfig] = useState<ClipsConfig | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false), [termsChecked, setTermsChecked] = useState(false);
  const [loading, setLoading] = useState(!!route.params?.draftId), [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false), [uploading, setUploading] = useState(false), [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [online, setOnline] = useState(true), [active, setActive] = useState(AppState.currentState === 'active');
  const [start, setStart] = useState('0'), [end, setEnd] = useState('60'), [playing, setPlaying] = useState(false), [recordSeconds, setRecordSeconds] = useState(60);
  const player = useRef<Video>(null), handle = useRef<ClipUploadHandle | null>(null);
  const cancelRequested = useRef(false);
  const position = useRef(0), seekGuard = useRef(false), mounted = useRef(true), draftRef = useRef<ClipDraft | null>(null), uploadGuard = useRef(false);
  const { rows: destinations, loading: groupsLoading } = useClipDestinations(draft?.audience === 'group');
  const maxSeconds = config?.maxDurationSeconds ?? INITIAL_MAX_SECONDS;
  const uid = auth.currentUser?.uid;

  function installDraft(value: ClipDraft) {
    draftRef.current = value; setDraft(value);
    setStart(String(value.trimStartMs / 1000)); setEnd(String(value.trimEndMs / 1000));
  }
  function change(fields: Partial<ClipDraft>) {
    setDraft(old => { if (!old) return old; const next = { ...old, ...fields }; draftRef.current = next; return next; });
    setNotice('');
  }
  async function loadConfig() {
    try {
      const value = await getClipsConfig();
      if (!mounted.current) return;
      setConfig(value.config); setTermsAccepted(value.termsAccepted); setTermsChecked(value.termsAccepted);
      setRecordSeconds(seconds => Math.min(seconds, value.config.maxDurationSeconds));
    } catch { if (mounted.current) setNotice(c('You can save a draft offline. Connect to publish.', 'يمكنك حفظ مسودة دون اتصال. اتصل بالإنترنت للنشر.')); }
  }
  useEffect(() => {
    mounted.current = true; void loadConfig();
    const net = NetInfo.addEventListener(state => setOnline(state.isConnected !== false && state.isInternetReachable !== false));
    const sub = AppState.addEventListener('change', state => { setActive(state === 'active'); if (state !== 'active') setPlaying(false); });
    return () => { mounted.current = false; cancelRequested.current = true; net(); sub.remove(); handle.current?.cancel(); handle.current = null; };
  }, []);
  useLayoutEffect(() => {
    let alive = true;
    draftRef.current = null; setDraft(null); setError(''); setNotice(''); setPlaying(false); setStart('0'); setEnd(String(maxSeconds));
    setLoading(!!route.params?.draftId);
    if (!route.params?.draftId) return;
    getClipDraft(route.params.draftId).then(async value => {
      if (!alive) return;
      if (!value) throw new Error('draft-missing');
      if (!(await FileSystem.getInfoAsync(value.localUri)).exists) throw new Error('clip-file-missing');
      if (!alive) return;
      installDraft(value);
    }).catch(() => { if (alive) setError(c('This draft or its video file is no longer available.', 'هذه المسودة أو ملف الفيديو لم يعد متاحًا.')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [route.params?.draftId, route.params?.draftRequestId]);
  useEffect(() => {
    if (!draft || uploading || draft.status === 'processing' || draft.uid !== uid) return;
    const timer = setTimeout(() => { if (!uploadGuard.current) void saveClipDraft(draft).catch(() => { if (mounted.current) setError(c('Could not save the draft on this device.', 'تعذّر حفظ المسودة على هذا الجهاز.')); }); }, 500);
    return () => clearTimeout(timer);
  }, [draft, uploading, uid]);
  useEffect(() => {
    const stop = navigation.addListener?.('beforeRemove', (event: any) => {
      if (!draftRef.current) return;
      if (!uploadGuard.current) { if (draftRef.current.status !== 'processing') void saveClipDraft(draftRef.current).catch(() => {}); return; }
      event.preventDefault();
      Alert.alert(c('Pause and leave?', 'إيقاف الرفع والمغادرة؟'), c('Your draft stays on this device. You can retry the upload later.', 'ستبقى المسودة على هذا الجهاز ويمكنك إعادة الرفع لاحقًا.'), [
        { text: c('Continue upload', 'متابعة الرفع'), style: 'cancel' },
        { text: c('Leave', 'مغادرة'), onPress: () => { cancelRequested.current = true; handle.current?.cancel(); handle.current = null; uploadGuard.current = false; navigation.dispatch(event.data.action); } },
      ]);
    });
    return stop;
  }, [navigation]);

  async function choose(record: boolean) {
    if (picking || uploading) return;
    const importingUid = auth.currentUser?.uid;
    setPicking(true); setError(''); setPlaying(false);
    try {
      if (record) {
        const camera = await ImagePicker.requestCameraPermissionsAsync();
        const microphone = await Audio.requestPermissionsAsync();
        if (!camera.granted || !microphone.granted) throw new Error('camera-permission');
      } else {
        const library = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!library.granted) throw new Error('library-permission');
      }
      const result = record ? await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: Math.min(recordSeconds, maxSeconds), videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsMultipleSelection: false, videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium });
      if (result.canceled || !result.assets?.[0]) return;
      if (!mounted.current || !importingUid || auth.currentUser?.uid !== importingUid) return;
      const asset = result.assets[0];
      if ((asset.fileSize ?? 0) > (config?.maxUploadMB ?? 80) * 1024 * 1024) throw new Error('file-too-large');
      const value = await createClipDraft({ uri: asset.uri, mimeType: asset.mimeType ?? 'video/mp4', durationMs: asset.duration ?? undefined, sizeBytes: asset.fileSize });
      if (!mounted.current) return;
      value.trimEndMs = Math.min(value.durationMs, maxSeconds * 1000);
      installDraft(await saveClipDraft(value));
    } catch (failure) {
      if (!mounted.current) return;
      const code = failure instanceof Error ? failure.message : '';
      setError(code.includes('permission') ? c('Allow camera, microphone or photo access in device settings to continue.', 'اسمح بالوصول للكاميرا والميكروفون أو الصور من إعدادات الجهاز للمتابعة.')
        : code === 'file-too-large' ? c(`Choose a video up to ${config?.maxUploadMB ?? 80} MB.`, `اختر فيديو بحجم لا يتجاوز ${config?.maxUploadMB ?? 80} ميغابايت.`)
          : c('Could not import this video. Try another file.', 'تعذّر استيراد الفيديو. جرّب ملفًا آخر.'));
    } finally { if (mounted.current) setPicking(false); }
  }
  function updateRange() {
    if (!draft || draft.status === 'processing') return null;
    const range = trimDraftRange(draft.durationMs, start, end, maxSeconds);
    if (!range) { setError(c(`Choose a valid range, up to ${maxSeconds} seconds.`, `حدد نطاقًا صحيحًا لا يتجاوز ${maxSeconds} ثانية.`)); return null; }
    const value = { ...draft, ...range, coverTimeMs: Math.max(range.trimStartMs, Math.min(draft.coverTimeMs, range.trimEndMs - 1)) };
    change(value); return value;
  }
  async function save() {
    const value = updateRange();
    if (!value) return;
    setSaving(true); setError('');
    try { installDraft(await saveClipDraft(value)); setNotice(c('Draft saved on this device.', 'حُفظت المسودة على هذا الجهاز.')); }
    catch { setError(c('Could not save the draft.', 'تعذّر حفظ المسودة.')); }
    finally { setSaving(false); }
  }
  async function publish() {
    if (uploadGuard.current || !draft) return;
    if (draft.status === 'processing' && draft.clipId) { navigation.replace('ClipViewer', { clipId: draft.clipId }); return; }
    const value = updateRange();
    if (!value) return;
    if (!value.audience || (value.audience === 'group' && !value.groupId)) { setError(c('Choose who can watch before publishing.', 'اختر من يمكنه المشاهدة قبل النشر.')); return; }
    if (!online) { setError(c('You are offline. Save the draft and publish when connected.', 'أنت غير متصل. احفظ المسودة وانشرها عند الاتصال.')); return; }
    if (!config?.enabled) { setError(c('Publishing is not available right now. Refresh settings or keep your draft.', 'النشر غير متاح الآن. حدّث الإعدادات أو احتفظ بمسودتك.')); void loadConfig(); return; }
    if (!termsChecked) { setError(c('Read and accept the community terms.', 'اقرأ شروط مجتمع المقاطع ووافق عليها.')); return; }
    uploadGuard.current = true; cancelRequested.current = false; setUploading(true); setProgress(0); setPaused(false); setPlaying(false); setError(''); setNotice('');
    try {
      if (!termsAccepted) { await acceptClipsTerms(config.termsVersion); setTermsAccepted(true); }
      if (!mounted.current || cancelRequested.current) throw new Error('clip-upload-cancelled');
      await saveClipDraft(value);
      if (!mounted.current || cancelRequested.current) throw new Error('clip-upload-cancelled');
      const upload = await startClipUpload(value, { onProgress: event => { if (mounted.current) { setProgress(event.progress); setPaused(event.state === 'paused'); } } });
      handle.current = upload;
      if (!mounted.current || cancelRequested.current) upload.cancel();
      const result = await upload.done;
      if (!mounted.current) return;
      const completed = await getClipDraft(value.id);
      if (!mounted.current) return;
      if (completed) installDraft(completed);
      handle.current = null; uploadGuard.current = false; setUploading(false);
      Alert.alert(c('Video received', 'تم استلام الفيديو'), c('Your clip is being prepared. It will be visible after processing and any required review.', 'يجري تجهيز المقطع، وسيظهر بعد المعالجة والمراجعة المطلوبة.'), [{ text: c('View my clip', 'عرض مقطعي'), onPress: () => navigation.replace('ClipViewer', { clipId: result.clipId }) }]);
    } catch (failure) {
      if (!mounted.current) return;
      const latest = await getClipDraft(value.id).catch(() => null);
      if (!mounted.current) return;
      if (latest) installDraft(latest);
      if (isClipTermsCancellation(failure)) return;
      const reason = failure instanceof Error ? failure.message : '';
      setError(reason.includes('cancel') ? c('Upload stopped. The draft is kept for retry.', 'توقف الرفع. المسودة محفوظة لإعادة المحاولة.') : c('Upload was not confirmed. Your draft is kept; reconnect and retry.', 'لم يتأكد رفع المقطع. المسودة محفوظة؛ أعد الاتصال وحاول مجددًا.'));
    } finally { if (mounted.current) { uploadGuard.current = false; setUploading(false); setPaused(false); handle.current = null; } }
  }
  function onPlayback(status: AVPlaybackStatus) {
    if (!status.isLoaded || !draft) return;
    position.current = status.positionMillis;
    if (status.durationMillis && (!draft.durationMs || !draft.trimEndMs)) {
      const duration = status.durationMillis;
      change({ durationMs: duration, trimEndMs: Math.min(duration, maxSeconds * 1000) }); setEnd(String(Math.min(duration, maxSeconds * 1000) / 1000));
    }
    if (playing && !seekGuard.current && (status.positionMillis >= draft.trimEndMs || status.positionMillis < draft.trimStartMs)) {
      seekGuard.current = true; void player.current?.setPositionAsync(draft.trimStartMs).finally(() => { seekGuard.current = false; });
    }
  }
  const audiences: Array<[ClipAudience, string, string, keyof typeof Ionicons.glyphMap]> = [['public', 'Public', 'عام', 'earth-outline'], ['followers', 'Approved followers', 'المتابعون المقبولون', 'people-outline'], ['group', 'A group', 'مجموعة محددة', 'chatbubbles-outline'], ['private', 'Only me', 'أنا فقط', 'lock-closed-outline']];
  return <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={[s.header, { paddingTop: insets.top + 12 }, rtl && { flexDirection: 'row-reverse' }]}><Pressable onPress={() => navigation.goBack()} hitSlop={12}><Ionicons name={rtl ? 'arrow-forward' : 'arrow-back'} size={24} color="#182330" /></Pressable><Text style={s.title}>{c('Create a clip', 'إنشاء مقطع')}</Text><Pressable onPress={() => navigation.navigate('ClipDrafts')} disabled={uploading || draft?.status === 'processing'}><Ionicons name="folder-open-outline" size={23} color="#1F7BA8" /></Pressable></View>
    <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 28 }} keyboardShouldPersistTaps="handled">
      {loading ? <ActivityIndicator color="#1F7BA8" style={{ margin: 30 }} /> : null}
      {!draft && !loading ? <View style={s.startCard}>
        <View style={s.cameraIcon}><Ionicons name="videocam-outline" size={46} color="#1F7BA8" /></View><Text style={s.headline}>{c('A moment worth sharing', 'لحظة تستحق المشاركة')}</Text><Text style={s.subtitle}>{c('Record now or choose a video from your phone.', 'سجّل الآن أو اختر فيديو من هاتفك.')}</Text>
        <View style={s.durations}>{[15, 30, 60].filter(n => n <= maxSeconds).map(n => <Pressable key={n} onPress={() => setRecordSeconds(n)} style={[s.duration, recordSeconds === n && s.selected]}><Text style={s.blue}>{n} {c('s', 'ث')}</Text></Pressable>)}</View>
        <Pressable onPress={() => void choose(true)} disabled={picking} style={s.primary}><Ionicons name="radio-button-on" size={22} color="#fff" /><Text style={s.primaryText}>{c('Record video', 'تسجيل فيديو')}</Text></Pressable>
        <Pressable onPress={() => void choose(false)} disabled={picking} style={s.secondary}><Ionicons name="images-outline" size={22} color="#1F7BA8" /><Text style={s.blue}>{c('Upload video', 'رفع فيديو')}</Text></Pressable>
        {picking ? <ActivityIndicator color="#1F7BA8" /> : null}
      </View> : null}
      {draft ? <>
        <View style={s.preview}>
          {focused && active ? <Video ref={player} source={{ uri: draft.localUri }} style={StyleSheet.absoluteFill} resizeMode={ResizeMode.CONTAIN} shouldPlay={playing && !uploading} isMuted={draft.mute} onPlaybackStatusUpdate={onPlayback} onError={() => setError(c('This video cannot be previewed. Choose a supported MP4 or MOV file.', 'تعذّرت معاينة الفيديو. اختر ملف MP4 أو MOV مدعومًا.'))} /> : null}
          {draft.overlayText ? <View pointerEvents="none" style={s.overlay}><Text style={s.overlayText}>{draft.overlayText}</Text></View> : null}
          <Pressable disabled={uploading || draft?.status === 'processing'} onPress={() => setPlaying(value => !value)} style={s.play} accessibilityLabel={c('Preview playback', 'تشغيل المعاينة')}><Ionicons name={playing ? 'pause' : 'play'} size={23} color="#fff" /></Pressable>
          <Pressable disabled={uploading || draft?.status === 'processing'} onPress={() => void choose(false)} style={s.replace}><Text style={s.white}>{c('Replace', 'استبدال')}</Text></Pressable>
        </View>
        <View style={s.section}><Text style={s.label}>{c('Trim video (seconds)', 'قص الفيديو (بالثواني)')}</Text><View style={s.range}>
          <View style={{ flex: 1 }}><Text style={s.hint}>{c('Start', 'البداية')}</Text><TextInput editable={!uploading && draft.status !== 'processing'} value={start} onChangeText={setStart} onBlur={updateRange} keyboardType="decimal-pad" style={s.input} accessibilityLabel={c('Trim start', 'بداية القص')} /></View>
          <View style={{ flex: 1 }}><Text style={s.hint}>{c('End', 'النهاية')}</Text><TextInput editable={!uploading && draft.status !== 'processing'} value={end} onChangeText={setEnd} onBlur={updateRange} keyboardType="decimal-pad" style={s.input} accessibilityLabel={c('Trim end', 'نهاية القص')} /></View>
        </View><Text style={s.hint}>{c(`Up to ${maxSeconds} seconds. Original: ${(draft.durationMs / 1000).toFixed(1)} s`, `حتى ${maxSeconds} ثانية. مدة الأصل: ${(draft.durationMs / 1000).toFixed(1)} ث`)}</Text>
          <Pressable disabled={uploading || draft?.status === 'processing'} style={s.smallButton} onPress={() => { const value = updateRange(); if (value) { const at = Math.max(value.trimStartMs, Math.min(position.current, value.trimEndMs - 1)); change({ coverTimeMs: at }); setNotice(c('Current frame selected as cover.', 'اختيرت اللقطة الحالية غلافًا.')); } }}><Ionicons name="image-outline" size={19} color="#1F7BA8" /><Text style={s.blue}>{c('Use current frame as cover', 'استخدام اللقطة الحالية غلافًا')}</Text></Pressable>
          <Text style={s.hint}>{c('Cover at ', 'الغلاف عند ')}{(draft.coverTimeMs / 1000).toFixed(1)} {c('s', 'ث')}</Text>
        </View>
        <Text style={s.label}>{c('Text on video', 'نص على الفيديو')}</Text><TextInput editable={!uploading && draft.status !== 'processing'} style={[s.input, { textAlign: rtl ? 'right' : 'left' }]} value={draft.overlayText} onChangeText={overlayText => change({ overlayText })} maxLength={120} placeholder={c('Optional short text', 'نص قصير اختياري')} placeholderTextColor="#8693A0" />
        <View style={s.toggle}><Text style={s.toggleLabel}>{c('Mute original audio', 'كتم الصوت الأصلي')}</Text><Switch disabled={uploading || draft?.status === 'processing'} value={draft.mute} onValueChange={mute => change({ mute })} trackColor={{ true: '#1F7BA8' }} /></View>
        <Text style={s.label}>{c('Caption and hashtags', 'الوصف والوسوم')}</Text><TextInput editable={!uploading && draft.status !== 'processing'} value={draft.caption} onChangeText={caption => change({ caption })} maxLength={2000} multiline style={[s.input, { minHeight: 90, textAlign: rtl ? 'right' : 'left' }]} placeholder={c('Tell the story… #topic', 'اكتب وصفًا… #موضوع')} placeholderTextColor="#8693A0" />
        <Text style={s.label}>{c('Who can watch? Choose before publishing.', 'من يمكنه المشاهدة؟ اختر قبل النشر.')}</Text>
        <Text style={s.hint}>{c('If your account is private, only approved followers can watch; group membership is also required for group clips.', 'إذا كان حسابك خاصًا، تقتصر المشاهدة على المتابعين المقبولين؛ وتتطلب مقاطع المجموعة عضوية المجموعة أيضًا.')}</Text>
        <View style={s.audiences}>{audiences.map(([key, en, ar, icon]) => <Pressable key={key} disabled={uploading || draft?.status === 'processing'} onPress={() => change({ audience: key, groupId: key === 'group' ? draft.groupId : null })} style={[s.audience, draft.audience === key && s.selected]} accessibilityRole="radio" accessibilityState={{ checked: draft.audience === key }}><Ionicons name={icon} color="#1F7BA8" size={22} /><Text style={s.audienceText}>{c(en, ar)}</Text>{draft.audience === key ? <Ionicons name="checkmark-circle" color="#1F7BA8" size={18} /> : null}</Pressable>)}</View>
        {draft.audience === 'group' ? <View style={s.groupList}>{groupsLoading ? <ActivityIndicator color="#1F7BA8" /> : null}{destinations.filter(row => row.type === 'group').map(row => <Pressable key={row.id} disabled={uploading || draft?.status === 'processing'} onPress={() => change({ groupId: row.id })} style={[s.group, draft.groupId === row.id && s.selected]}><Text style={s.toggleLabel}>{row.label}</Text><Ionicons name={draft.groupId === row.id ? 'checkbox' : 'square-outline'} size={22} color="#1F7BA8" /></Pressable>)}{!groupsLoading && !destinations.some(row => row.type === 'group') ? <Text style={s.hint}>{c('Join or create a group first.', 'انضم إلى مجموعة أو أنشئ مجموعة أولًا.')}</Text> : null}</View> : null}
        <View style={s.toggle}><Text style={s.toggleLabel}>{c('Allow comments', 'السماح بالتعليقات')}</Text><Switch disabled={uploading || draft?.status === 'processing'} value={draft.allowComments} onValueChange={allowComments => change({ allowComments })} trackColor={{ true: '#1F7BA8' }} /></View>
        <View style={s.toggle}><Text style={s.toggleLabel}>{c('Allow downloads', 'السماح بالتنزيل')}</Text><Switch disabled={uploading || draft?.status === 'processing'} value={draft.allowDownload} onValueChange={allowDownload => change({ allowDownload })} trackColor={{ true: '#1F7BA8' }} /></View>
        {!termsAccepted ? <View style={s.terms}><Text style={s.label}>{c('Community terms', 'شروط مجتمع المقاطع')}</Text><Text style={s.termsText}>{c(CLIPS_COMMUNITY_TERMS.en, CLIPS_COMMUNITY_TERMS.ar)}</Text><Pressable disabled={uploading || draft?.status === 'processing'} style={s.check} onPress={() => setTermsChecked(value => !value)} accessibilityRole="checkbox" accessibilityState={{ checked: termsChecked }}><Ionicons name={termsChecked ? 'checkbox' : 'square-outline'} size={24} color="#1F7BA8" /><Text style={s.toggleLabel}>{c('I agree to the Clips community terms.', 'أوافق على شروط مجتمع المقاطع.')}</Text></Pressable></View> : null}
        {uploading ? <View style={s.upload}><View style={s.progressTrack}><View style={[s.progressFill, { width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }]} /></View><Text style={s.blue}>{paused ? c('Upload paused', 'الرفع متوقف مؤقتًا') : progress >= 1 ? c('Confirming publication…', 'جارٍ تأكيد النشر…') : c(`Uploading ${Math.round(progress * 100)}%`, `جارٍ الرفع ${Math.round(progress * 100)}٪`)}</Text><View style={s.range}><Pressable onPress={() => { if (paused) handle.current?.resume(); else handle.current?.pause(); }} style={s.smallButton}><Text style={s.blue}>{paused ? c('Resume', 'استئناف') : c('Pause', 'إيقاف مؤقت')}</Text></Pressable><Pressable onPress={() => { cancelRequested.current = true; handle.current?.cancel(); }} style={s.smallButton}><Text style={{ color: '#AE3648' }}>{c('Cancel upload', 'إلغاء الرفع')}</Text></Pressable></View></View> : <View style={s.range}><Pressable onPress={() => void save()} disabled={saving || draft.status === 'processing'} style={[s.secondary, { flex: 1 }]}>{saving ? <ActivityIndicator color="#1F7BA8" /> : <Text style={s.blue}>{c('Save draft', 'حفظ مسودة')}</Text>}</Pressable><Pressable onPress={() => void publish()} disabled={saving || !draft.audience || !termsChecked} style={[s.primary, { flex: 1 }, (saving || !draft.audience || !termsChecked) && { opacity: 0.5 }]}><Text style={s.primaryText}>{draft.status === 'processing' ? c('View my clip', 'عرض مقطعي') : c('Publish', 'نشر')}</Text></Pressable></View>}
      </> : null}
      {config && !config.enabled ? <Text style={s.hint}>{c('Clips publishing is currently disabled. Your drafts remain on this device.', 'نشر المقاطع معطل حاليًا. تبقى مسوداتك على هذا الجهاز.')}</Text> : null}
      {!online ? <Text style={s.hint}>{c('Offline — drafts are saved locally.', 'غير متصل — تُحفظ المسودات محليًا.')}</Text> : null}
      {notice ? <Text style={s.notice}>{notice}</Text> : null}{error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
    </ScrollView>
  </KeyboardAvoidingView>;
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 15 }, title: { color: '#172A3A', fontWeight: '800', fontSize: 21 }, startCard: { paddingVertical: 28, alignItems: 'center' }, cameraIcon: { width: 100, height: 100, borderRadius: 32, backgroundColor: '#E3F1FA', justifyContent: 'center', alignItems: 'center', marginVertical: 20 }, headline: { color: '#172A3A', fontWeight: '800', fontSize: 22 }, subtitle: { fontSize: 14, color: '#718091', textAlign: 'center', marginVertical: 14, lineHeight: 23 }, durations: { flexDirection: 'row', gap: 12, marginVertical: 15 }, duration: { paddingVertical: 9, paddingHorizontal: 20, borderRadius: 18, backgroundColor: '#F4F7FA' }, selected: { backgroundColor: '#E3F1FA', borderColor: '#8FC4E1' }, primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, backgroundColor: '#1F7BA8', paddingHorizontal: 20, paddingVertical: 15, borderRadius: 16, marginVertical: 7, minWidth: 120 }, primaryText: { fontWeight: '800', color: '#fff', fontSize: 16 }, secondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 15, backgroundColor: '#E3F1FA', borderRadius: 16, marginVertical: 7, minWidth: 120 }, blue: { color: '#1F7BA8', fontWeight: '700', fontSize: 14 }, preview: { height: 300, backgroundColor: '#101820', borderRadius: 20, overflow: 'hidden' }, play: { position: 'absolute', bottom: 12, start: 12, padding: 12, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.4)' }, replace: { position: 'absolute', top: 12, end: 12, padding: 9, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.4)' }, white: { color: '#fff', fontWeight: '700' }, overlay: { position: 'absolute', bottom: 70, left: 30, right: 30, alignItems: 'center' }, overlayText: { color: '#fff', fontSize: 21, fontWeight: '700', textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, padding: 8 }, section: { marginVertical: 16 }, label: { fontSize: 14, color: '#1D2B3A', fontWeight: '800', marginTop: 8, marginBottom: 8 }, range: { flexDirection: 'row', gap: 12, alignItems: 'center' }, input: { backgroundColor: '#F3F6F9', color: '#1D2B3A', paddingHorizontal: 13, paddingVertical: 12, borderRadius: 13, borderWidth: 1, borderColor: '#DCE5EC', fontSize: 15, marginBottom: 9 }, hint: { color: '#7B8896', fontSize: 12, lineHeight: 20 }, smallButton: { flexDirection: 'row', gap: 7, alignItems: 'center', padding: 11, borderRadius: 10, backgroundColor: '#ECF5FA', marginVertical: 8 }, toggle: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E1E8EF' }, toggleLabel: { flex: 1, color: '#1D2B3A', fontSize: 14 }, audiences: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }, audience: { flexDirection: 'row', gap: 7, alignItems: 'center', borderWidth: 1, borderColor: '#DCE5EC', borderRadius: 13, padding: 12, minWidth: '46%', flexGrow: 1 }, audienceText: { color: '#1D2B3A', fontSize: 13, flex: 1 }, groupList: { borderRadius: 13, borderWidth: 1, borderColor: '#DCE5EC', padding: 7, marginBottom: 12 }, group: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, padding: 11 }, terms: { marginVertical: 16, padding: 14, backgroundColor: '#F4F8FB', borderRadius: 14 }, termsText: { color: '#637588', fontSize: 13, lineHeight: 22 }, check: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 14 }, progressTrack: { height: 7, borderRadius: 5, backgroundColor: '#DAE7F0', overflow: 'hidden', marginVertical: 15 }, progressFill: { height: 7, backgroundColor: '#1F7BA8' }, upload: { marginTop: 14 }, error: { color: '#A82D40', backgroundColor: '#FFF1F3', padding: 14, borderRadius: 12, marginTop: 15, lineHeight: 22 }, notice: { color: '#246C52', marginTop: 14, textAlign: 'center', lineHeight: 21 },
});
