// Static showcase of the new composer / conversation UI, for screenshots and
// review on the web (react-native-web). Built only with
// EXPO_PUBLIC_FEATURE_GALLERY=1 (see index.js); never part of the app bundle.
// Uses the REAL components with sample data — no Firebase, no local DB.
//
//   EXPO_PUBLIC_FEATURE_GALLERY=1 npx expo export -p web --output-dir dist-gallery
//   open dist-gallery/index.html#chat   (sections: chat, emoji, emoji-search,
//   stickers, create-poll, sync). Language follows the browser (en / ar).

import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../src/i18n';
import i18n, { isRTL } from '../src/i18n';
import { ComposerPanel } from '../src/components/chat/ComposerPanel';
import { PollBubble } from '../src/components/chat/PollBubble';
import { StickerBubble } from '../src/components/chat/StickerBubble';
import { CreatePollSheet } from '../src/components/chat/CreatePollSheet';
import { SyncStatusBanner } from '../src/components/chat/SyncStatusBanner';
import { sanitizePoll } from '../src/lib/pollModel';

const ME = 'gallery-me';
const ar = () => i18n.language === 'ar';

function samplePolls() {
  const lunch = sanitizePoll({
    question: ar() ? 'وين نتغدّى يوم الجمعة؟' : 'Where should we have lunch on Friday?',
    multiple: false, closed: false,
    options: ar()
      ? [{ id: 'o1', text: 'مطعم الريف' }, { id: 'o2', text: 'فلافل أبو سالم' }, { id: 'o3', text: 'بيتزا' }]
      : [{ id: 'o1', text: 'The garden restaurant' }, { id: 'o2', text: 'Falafel corner' }, { id: 'o3', text: 'Pizza' }],
    votes: { a: ['o1'], b: ['o2'], c: ['o1'], [ME]: ['o1'], d: ['o3'] },
  });
  const days = sanitizePoll({
    question: ar() ? 'أي الأيام تناسبكم للاجتماع؟' : 'Which days work for the meeting?',
    multiple: true, closed: false,
    options: ar()
      ? [{ id: 'o1', text: 'الأحد' }, { id: 'o2', text: 'الثلاثاء' }, { id: 'o3', text: 'الخميس' }]
      : [{ id: 'o1', text: 'Sunday' }, { id: 'o2', text: 'Tuesday' }, { id: 'o3', text: 'Thursday' }],
    votes: { a: ['o1', 'o3'], b: ['o3'], [ME]: ['o2', 'o3'] },
  });
  return { lunch, days };
}

function Bubble({ mine, children, name }: { mine?: boolean; children: React.ReactNode; name?: string }) {
  return (
    <View style={[s.row, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
      <View style={[s.bubble, mine ? s.mine : s.theirs]}>
        {name ? <Text style={s.sender}>{name}</Text> : null}
        {children}
        <Text style={s.time}>12:4{mine ? '6' : '2'}</Text>
      </View>
    </View>
  );
}

function Header() {
  return (
    <View style={s.header}>
      <View style={s.avatar}><Text style={s.avatarText}>{ar() ? 'ف' : 'T'}</Text></View>
      <View>
        <Text style={s.title}>{ar() ? 'فريق العمل' : 'Team'}</Text>
        <Text style={s.subtitle}>{ar() ? '٦ أعضاء' : '6 members'}</Text>
      </View>
    </View>
  );
}

function FakeComposer({ panel }: { panel?: boolean }) {
  return (
    <View style={s.composer}>
      <View style={s.pill}>
        <Text style={s.icon}>{panel ? '⌨️' : '🙂'}</Text>
        <Text style={s.placeholder}>{ar() ? 'رسالة' : 'Message'}</Text>
        <Text style={s.icon}>📎</Text>
      </View>
      <View style={s.mic}><Text style={{ color: '#fff', fontSize: 18 }}>🎤</Text></View>
    </View>
  );
}

function Chat() {
  const { lunch, days } = samplePolls();
  return (
    <View style={{ flex: 1 }}>
      <Header />
      <ScrollView style={s.wall} contentContainerStyle={{ paddingVertical: 10, gap: 6 }}>
        <Bubble name="Lina"><Text style={s.text}>{ar() ? 'نحدد مكان الغداء؟ 👇' : 'Shall we pick a place for lunch? 👇'}</Text></Bubble>
        <Bubble name="Lina">
          <PollBubble poll={lunch} me={ME} isCreator={false} mine={false} onVote={() => {}} onClose={() => {}} />
        </Bubble>
        <View style={[s.row, { justifyContent: 'flex-end' }]}>
          <StickerBubble sticker={{ packId: 'simsim', stickerId: ar() ? 'thanks_ar' : 'thanks_en', alt: '🙏' }} />
        </View>
        <Bubble mine>
          <PollBubble poll={days} me={ME} isCreator mine onVote={() => {}} onClose={() => {}} />
        </Bubble>
        <View style={[s.row, { justifyContent: 'flex-start' }]}>
          <StickerBubble sticker={{ packId: 'simsim', stickerId: 'party', alt: '🥳' }} />
        </View>
      </ScrollView>
      <SyncStatusBanner focus={{ messageId: 'm', state: 'fetching' }} live="live" onRetry={() => {}} />
      <FakeComposer />
    </View>
  );
}

function Panel({ tab, query }: { tab: 'emoji' | 'stickers'; query?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Header />
      <View style={[s.wall, { flex: 1 }]} />
      <FakeComposer panel />
      <ComposerPanel uid={ME} height={360} bottomInset={0} initialTab={tab} initialQuery={query} onEmoji={() => {}} onSticker={() => {}} customSendingAvailable />
    </View>
  );
}

function Sync() {
  const rows: Array<[string, any, any]> = [
    ['Notification tapped, message loading', { messageId: 'm', state: 'fetching' }, 'live'],
    ['Offline when tapped', { messageId: 'm', state: 'waiting-network' }, 'offline'],
    ['Fetch failed (retry)', { messageId: 'm', state: 'error' }, 'live'],
    ['Message deleted / no access', { messageId: 'm', state: 'missing' }, 'live'],
    ['Offline, browsing saved messages', null, 'offline'],
  ];
  return (
    <View style={{ flex: 1 }}>
      <Header />
      <ScrollView contentContainerStyle={{ gap: 18, padding: 12 }}>
        {rows.map(([label, focus, live]) => (
          <View key={label} style={{ gap: 4 }}>
            <Text style={s.caption}>{label}</Text>
            <SyncStatusBanner focus={focus} live={live} onRetry={() => {}} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export default function FeatureGallery() {
  const [ready, setReady] = useState(false);
  const section = (Platform.OS === 'web' ? window.location.hash.slice(1) : '') || 'chat';
  useEffect(() => {
    if (Platform.OS === 'web') document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    // Seed "recently used" so the panels show that section.
    void Promise.all([
      AsyncStorage.setItem(`recents.emoji.v1:${ME}`, JSON.stringify(['😂', '❤️', '👍', '🙏', '🎉', '😍', '🔥', '🇵🇸'])),
      AsyncStorage.setItem(`recents.sticker.v1:${ME}`, JSON.stringify(['simsim/hi', 'simsim/love', 'simsim/thanks_ar'])),
    ]).then(() => setReady(true));
  }, []);
  if (!ready) return null;
  return (
    <SafeAreaProvider>
    <View style={s.page}>
      <View style={s.phone}>
        {section === 'chat' ? <Chat /> : null}
        {section === 'emoji' ? <Panel tab="emoji" /> : null}
        {section === 'emoji-search' ? <Panel tab="emoji" query={ar() ? 'قلب' : 'heart'} /> : null}
        {section === 'stickers' ? <Panel tab="stickers" /> : null}
        {section === 'sync' ? <Sync /> : null}
        {section === 'create-poll' ? (
          <View style={{ flex: 1 }}>
            <Header />
            <View style={[s.wall, { flex: 1 }]} />
            <CreatePollSheet
              visible
              onClose={() => {}}
              onCreate={() => {}}
              initial={ar()
                ? { question: 'وين نتغدّى يوم الجمعة؟', options: ['مطعم الريف', 'فلافل أبو سالم', 'بيتزا'], multiple: false }
                : { question: 'Where should we have lunch on Friday?', options: ['The garden restaurant', 'Falafel corner', 'Pizza'], multiple: false }}
            />
          </View>
        ) : null}
      </View>
    </View>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  page:     { flex: 1, backgroundColor: '#E9EEF2', alignItems: 'center' },
  phone:    { width: '100%', maxWidth: 420, flex: 1, backgroundColor: '#fff', overflow: 'hidden' },
  header:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E3E8EC' },
  avatar:   { width: 38, height: 38, borderRadius: 19, backgroundColor: '#2E9BD6', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '800' },
  title:    { fontSize: 16, fontWeight: '700', color: '#16212B' },
  subtitle: { fontSize: 12, color: '#6B7B8A' },
  wall:     { backgroundColor: '#CFE3D3' },
  row:      { flexDirection: 'row', paddingHorizontal: 10 },
  bubble:   { borderRadius: 14, paddingHorizontal: 6, paddingVertical: 6, maxWidth: '86%' },
  mine:     { backgroundColor: '#EFFDDE' },
  theirs:   { backgroundColor: '#fff' },
  sender:   { fontSize: 13, fontWeight: '700', color: '#C2410C', paddingHorizontal: 6, paddingBottom: 2 },
  text:     { fontSize: 15, color: '#16212B', paddingHorizontal: 6 },
  time:     { fontSize: 11, color: '#7A8B99', alignSelf: 'flex-end', paddingHorizontal: 6 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, backgroundColor: '#CFE3D3' },
  pill:     { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 22, paddingHorizontal: 12, height: 44 },
  icon:     { fontSize: 20 },
  placeholder: { flex: 1, color: '#9AA9B6', fontSize: 15 },
  mic:      { width: 44, height: 44, borderRadius: 22, backgroundColor: '#2E9BD6', alignItems: 'center', justifyContent: 'center' },
  caption:  { fontSize: 13, color: '#4A5A68', fontWeight: '600' },
});
