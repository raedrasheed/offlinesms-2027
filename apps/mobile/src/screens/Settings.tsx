// Settings screen — Phase 19.
// Adds language, theme, notification, and time-format preferences.
// Accessibility labels on all interactive elements.
// Uses useTranslation() for all user-facing strings.

import { useEffect, useState } from 'react';
import {
  View, Text, Pressable, Switch, StyleSheet, Alert, ScrollView, Image,
  I18nManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { signOut } from '../lib/auth';
import { auth } from '../lib/firebase';
import {
  subscribeMe,
  setSmsOptOut,
  setPreferredLanguage,
  setPreferredTheme,
  setInAppNotifications,
  setTimeFormat,
  type ThemePreference,
  type TimeFormat,
  type LanguageCode,
} from '../lib/user';
import { subscribeWallet, Wallet } from '../lib/points';
import { conversationsRepo, messagesRepo, getCurrentUid, openLocalDb } from '../localdb';
import { useTheme } from '../context/ThemeContext';
import { changeLanguage, isRTL } from '../i18n';
import { radius } from '../theme';

const LANGUAGES: { code: LanguageCode; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
];

const THEMES: { value: ThemePreference; labelKey: string }[] = [
  { value: 'system', labelKey: 'settings.themeSystem' },
  { value: 'light',  labelKey: 'settings.themeLight' },
  { value: 'dark',   labelKey: 'settings.themeDark' },
];

const TIME_FORMATS: { value: TimeFormat; labelKey: string }[] = [
  { value: 'system', labelKey: 'settings.timeFormatSystem' },
  { value: '12h',    labelKey: 'settings.timeFormat12' },
  { value: '24h',    labelKey: 'settings.timeFormat24' },
];

function profileInitials(name?: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Settings({ navigation }: any) {
  const { t, i18n } = useTranslation();
  const { colors, preference: themePref, setPreference: setThemePref } = useTheme();
  const me = auth.currentUser?.uid;
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [optOut, setOptOut]             = useState<boolean | null>(null);
  const [inAppNotifs, setInAppNotifs]   = useState<boolean>(true);
  const [currentLang, setCurrentLang]   = useState<LanguageCode>((i18n.language as LanguageCode) || 'en');
  const [currentTime, setCurrentTime]   = useState<TimeFormat>('system');
  const [busy, setBusy]                 = useState(false);
  const [profile, setProfile]           = useState<{ displayName?: string; username?: string; photoURL?: string | null }>({});
  const [localStats, setLocalStats]     = useState<{ chats: number; messages: number } | null>(null);

  useEffect(() => {
    if (!me) return;
    return subscribeWallet(me, setWallet);
  }, [me]);

  useEffect(() => {
    if (!me) return;
    let active = true;
    async function refreshLocalStats() {
      try {
        if (!getCurrentUid()) await openLocalDb(me!);
        const [chats, messages] = await Promise.all([
          conversationsRepo.countConversations(),
          messagesRepo.countMessages(),
        ]);
        if (active) setLocalStats({ chats, messages });
      } catch {
        if (active) setLocalStats({ chats: 0, messages: 0 });
      }
    }
    refreshLocalStats();
    const unsub = navigation.addListener('focus', refreshLocalStats);
    return () => { active = false; unsub(); };
  }, [me, navigation]);

  useEffect(() => {
    if (!me) return;
    return subscribeMe(me, m => {
      setOptOut(m?.smsOptOut === true);
      if (m?.inAppNotifications != null) setInAppNotifs(m.inAppNotifications);
      if (m?.timeFormat) setCurrentTime(m.timeFormat);
      if (m?.preferredLanguage) setCurrentLang(m.preferredLanguage);
      setProfile({ displayName: m?.displayName, username: m?.username, photoURL: m?.photoURL });
    });
  }, [me]);

  async function withBusy(fn: () => Promise<void>) {
    if (!me || busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      Alert.alert(t('settings.updateFailed'), e?.message ?? '');
    } finally {
      setBusy(false);
    }
  }

  async function handleLangChange(lang: LanguageCode) {
    setCurrentLang(lang);
    await withBusy(async () => {
      await changeLanguage(lang);
      await setPreferredLanguage(me!, lang);
    });
  }

  async function handleThemeChange(theme: ThemePreference) {
    setThemePref(theme);
    await withBusy(() => setPreferredTheme(me!, theme));
  }

  const s = buildStyles(colors, isRTL);

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.content}
      accessibilityLabel={t('settings.title')}
    >

      {/* Profile header card */}
      <Pressable
        style={s.profileCard}
        onPress={() => navigation.navigate('EditProfile')}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={t('settings.profile')}
      >
        <View style={s.profileAv}>
          {profile.photoURL
            ? <Image source={{ uri: profile.photoURL }} style={s.profileAvImg} />
            : <Text style={s.profileAvText}>{profileInitials(profile.displayName)}</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.profileName} numberOfLines={1}>{profile.displayName || t('settings.profile')}</Text>
          <Text style={s.profileSub} numberOfLines={1}>{profile.username ? `@${profile.username}` : t('settings.editProfileHint')}</Text>
        </View>
        <Text style={s.chev} accessibilityElementsHidden>{isRTL ? '‹' : '›'}</Text>
      </Pressable>

      {/* Find friends */}
      <Pressable
        style={s.row}
        onPress={() => navigation.navigate('FindFriends')}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={t('settings.findFriends')}
      >
        <Text style={s.title}>{t('settings.findFriends')}</Text>
        <Text style={s.chev} accessibilityElementsHidden>{isRTL ? '‹' : '›'}</Text>
      </Pressable>

      {/* Security PIN */}
      <Pressable
        style={s.row}
        onPress={() => navigation.navigate('CreatePin')}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={t('settings.securityPin')}
      >
        <Text style={s.title}>{t('settings.securityPin')}</Text>
        <Text style={s.chev} accessibilityElementsHidden>{isRTL ? '‹' : '›'}</Text>
      </Pressable>

      {/* Permissions */}
      <Pressable
        style={s.row}
        onPress={() => navigation.navigate('Permissions')}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={t('settings.permissions')}
      >
        <Text style={s.title}>{t('settings.permissions')}</Text>
        <Text style={s.chev} accessibilityElementsHidden>{isRTL ? '‹' : '›'}</Text>
      </Pressable>

      {/* Points */}
      <Pressable
        style={s.row}
        onPress={() => navigation.navigate('Points')}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={t('settings.points')}
        accessibilityHint={t('settings.pointsSubtitle')}
      >
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{t('settings.points')}</Text>
          <Text style={s.sub}>
            {wallet
              ? `${wallet.balance.toLocaleString()} pts  ·  ${wallet.reserved.toLocaleString()} ${t('points.reserved').toLowerCase()}`
              : t('settings.pointsSubtitle')}
          </Text>
        </View>
        <Text style={s.chev} accessibilityElementsHidden>{isRTL ? '‹' : '›'}</Text>
      </Pressable>

      {/* SMS reminders toggle */}
      <View style={s.toggleRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{t('settings.smsReminders')}</Text>
          <Text style={s.sub}>
            {optOut === true ? t('settings.smsRemindersOff') : t('settings.smsRemindersOn')}
          </Text>
        </View>
        <Switch
          value={optOut !== true}
          onValueChange={v => withBusy(() => setSmsOptOut(me!, !v))}
          disabled={optOut === null || busy}
          accessibilityLabel={t('settings.smsReminders')}
          accessibilityRole="switch"
          accessibilityState={{ checked: optOut !== true, disabled: optOut === null || busy }}
        />
      </View>

      {/* In-app notifications toggle */}
      <View style={s.toggleRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{t('settings.inAppNotifications')}</Text>
          <Text style={s.sub}>{t('settings.inAppNotificationsSubtitle')}</Text>
        </View>
        <Switch
          value={inAppNotifs}
          onValueChange={v => withBusy(() => setInAppNotifications(me!, v))}
          disabled={busy}
          accessibilityLabel={t('settings.inAppNotifications')}
          accessibilityRole="switch"
          accessibilityState={{ checked: inAppNotifs, disabled: busy }}
        />
      </View>

      {/* Language */}
      <View style={s.section}>
        <Text style={s.sectionLabel}>{t('settings.language')}</Text>
        <View style={s.chipRow}>
          {LANGUAGES.map(lang => (
            <Pressable
              key={lang.code}
              style={[s.chip, currentLang === lang.code && s.chipActive]}
              onPress={() => handleLangChange(lang.code)}
              accessibilityRole="radio"
              accessibilityLabel={lang.label}
              accessibilityState={{ selected: currentLang === lang.code, disabled: busy }}
            >
              <Text style={[s.chipText, currentLang === lang.code && s.chipTextActive]}>
                {lang.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Theme */}
      <View style={s.section}>
        <Text style={s.sectionLabel}>{t('settings.theme')}</Text>
        <View style={s.chipRow}>
          {THEMES.map(th => (
            <Pressable
              key={th.value}
              style={[s.chip, themePref === th.value && s.chipActive]}
              onPress={() => handleThemeChange(th.value)}
              accessibilityRole="radio"
              accessibilityLabel={t(th.labelKey)}
              accessibilityState={{ selected: themePref === th.value, disabled: busy }}
            >
              <Text style={[s.chipText, themePref === th.value && s.chipTextActive]}>
                {t(th.labelKey)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Appearance — chat wallpaper */}
      <View style={s.section}>
        <Text style={s.sectionLabel}>Appearance</Text>
        <Pressable
          style={s.linkRow}
          onPress={() => (navigation as any).navigate('ChatWallpaper')}
          accessibilityRole="button"
          accessibilityLabel="Chat wallpaper"
        >
          <Text style={s.linkRowText}>Chat wallpaper</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.text.muted} />
        </Pressable>
        <Pressable
          style={s.linkRow}
          onPress={() => (navigation as any).navigate('NotificationSettings')}
          accessibilityRole="button"
          accessibilityLabel="Notifications"
        >
          <Text style={s.linkRowText}>Notifications</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.text.muted} />
        </Pressable>
      </View>

      {/* Time format */}
      <View style={s.section}>
        <Text style={s.sectionLabel}>{t('settings.timeFormat')}</Text>
        <View style={s.chipRow}>
          {TIME_FORMATS.map(tf => (
            <Pressable
              key={tf.value}
              style={[s.chip, currentTime === tf.value && s.chipActive]}
              onPress={() => withBusy(() => setTimeFormat(me!, tf.value).then(() => setCurrentTime(tf.value)))}
              accessibilityRole="radio"
              accessibilityLabel={t(tf.labelKey)}
              accessibilityState={{ selected: currentTime === tf.value, disabled: busy }}
            >
              <Text style={[s.chipText, currentTime === tf.value && s.chipTextActive]}>
                {t(tf.labelKey)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Privacy */}
      <Pressable
        style={s.row}
        onPress={() => navigation.navigate('Privacy')}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={t('settings.privacy')}
      >
        <Text style={s.title}>{t('settings.privacy')}</Text>
        <Text style={s.chev} accessibilityElementsHidden>{isRTL ? '‹' : '›'}</Text>
      </Pressable>

      {/* Linked devices */}
      <Pressable
        style={s.row}
        onPress={() => navigation.navigate('Devices')}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={t('settings.linkedDevices')}
      >
        <Text style={s.title}>{t('settings.linkedDevices')}</Text>
        <Text style={s.chev} accessibilityElementsHidden>{isRTL ? '‹' : '›'}</Text>
      </Pressable>

      {/* On-device storage */}
      <View
        style={s.section}
        accessible={true}
        accessibilityLabel={`${t('settings.localStorage')}. ${
          localStats
            ? `${t('settings.localChats')}: ${localStats.chats}, ${t('settings.localMessages')}: ${localStats.messages}`
            : t('settings.localStorageSubtitle')
        }`}
      >
        <Text style={s.sectionLabel}>{t('settings.localStorage')}</Text>
        <Text style={s.sub}>{t('settings.localStorageSubtitle')}</Text>
        {localStats && localStats.chats === 0 && localStats.messages === 0 ? (
          <Text style={[s.sub, { marginTop: 10 }]}>{t('settings.localStorageEmpty')}</Text>
        ) : (
          <View style={s.statRow}>
            <View style={s.statBox}>
              <Text style={s.statValue}>{(localStats?.chats ?? 0).toLocaleString()}</Text>
              <Text style={s.statLabel}>{t('settings.localChats')}</Text>
            </View>
            <View style={s.statBox}>
              <Text style={s.statValue}>{(localStats?.messages ?? 0).toLocaleString()}</Text>
              <Text style={s.statLabel}>{t('settings.localMessages')}</Text>
            </View>
          </View>
        )}
      </View>

      {/* Help & Support */}
      <Pressable
        style={s.row}
        onPress={() => navigation.navigate('SupportTicket')}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={t('settings.helpSupport')}
      >
        <Text style={s.title}>{t('settings.helpSupport')}</Text>
        <Text style={s.chev} accessibilityElementsHidden>{isRTL ? '‹' : '›'}</Text>
      </Pressable>

      {/* Sign out */}
      <Pressable
        style={s.row}
        onPress={() => signOut()}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={t('settings.signOut')}
      >
        <Text style={[s.title, { color: colors.state.error }]}>{t('settings.signOut')}</Text>
      </Pressable>
    </ScrollView>
  );
}

function buildStyles(colors: any, rtl: boolean) {
  return StyleSheet.create({
    root:         { flex: 1, backgroundColor: colors.background.app },
    content:      { padding: 14, paddingBottom: 150, gap: 8 },
    row:          { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 14, backgroundColor: colors.background.surface, borderRadius: radius.md, gap: 10 },
    toggleRow:    { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 14, backgroundColor: colors.background.surface, borderRadius: radius.md, gap: 12 },
    profileCard:  { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 14, padding: 14, backgroundColor: colors.background.surface, borderRadius: radius.md },
    profileAv:    { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.action.primary, alignItems: 'center', justifyContent: 'center' },
    profileAvImg: { width: 52, height: 52, borderRadius: 26 },
    profileAvText:{ color: colors.action.primaryFg, fontWeight: '800', fontSize: 16 },
    profileName:  { fontSize: 16, fontWeight: '800', color: colors.text.primary, textAlign: rtl ? 'right' : 'left' },
    profileSub:   { fontSize: 12, color: colors.text.muted, marginTop: 2, textAlign: rtl ? 'right' : 'left' },
    title:        { fontSize: 14, fontWeight: '700', color: colors.text.primary, flex: 1, textAlign: rtl ? 'right' : 'left', lineHeight: 20 },
    sub:          { fontSize: 12, color: colors.text.muted, marginTop: 2, textAlign: rtl ? 'right' : 'left', lineHeight: 16 },
    chev:         { fontSize: 18, color: colors.text.disabled, fontWeight: '700' },
    section:      { backgroundColor: colors.background.surface, borderRadius: radius.md, padding: 14 },
    sectionLabel: { fontSize: 12, fontWeight: '700', color: colors.text.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: rtl ? 'right' : 'left' },
    chipRow:      { flexDirection: rtl ? 'row-reverse' : 'row', gap: 8, flexWrap: 'wrap' },
    linkRow:      { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, marginTop: 8 },
    linkRowText:  { fontSize: 15, fontWeight: '600', color: colors.text.primary },
    chip:         { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.background.subtle, borderWidth: 1, borderColor: colors.border.subtle, minHeight: 36, justifyContent: 'center' },
    chipActive:   { backgroundColor: colors.action.primary, borderColor: colors.action.primary },
    chipText:     { fontSize: 13, fontWeight: '600', color: colors.text.secondary },
    chipTextActive: { color: colors.action.primaryFg },
    statRow:      { flexDirection: rtl ? 'row-reverse' : 'row', gap: 10, marginTop: 12 },
    statBox:      { flex: 1, backgroundColor: colors.background.subtle, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 12, alignItems: 'center' },
    statValue:    { fontSize: 22, fontWeight: '800', color: colors.text.primary },
    statLabel:    { fontSize: 12, color: colors.text.muted, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  });
}
