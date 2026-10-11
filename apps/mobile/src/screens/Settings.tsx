// Settings screen — Phase 19.
// Adds language, theme, notification, and time-format preferences.
// Accessibility labels on all interactive elements.
// Uses useTranslation() for all user-facing strings.
//
// Telegram-style layout: large centered avatar + name + phone/username
// header, then grouped cards whose rows carry colored icon chips.

import { useEffect, useState } from 'react';
import {
  View, Text, Pressable, Switch, StyleSheet, Alert, ScrollView, Image, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { signOut, deleteMyAccount } from '../lib/auth';
import { getPhoneLinkStatus, type PhoneLinkStatus } from '../lib/phoneLink';
import { phoneLinkRow } from '../lib/phoneLink.helpers';
import { getSignInMethods, type SignInMethods } from '../lib/signInMethods';
import { signInMethodRows, formatOwnPhone } from '../lib/signInMethods.helpers';
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

// Telegram-style icon chip colors per row.
const CHIP = {
  findFriends:  '#2196F3',
  securityPin:  '#4CAF50',
  phone:        '#009688',
  email:        '#5C6BC0',
  permissions:  '#FF9800',
  points:       '#FFB300',
  smsReminders: '#E91E63',
  inAppNotifs:  '#F44336',
  wallpaper:    '#00BCD4',
  notifs:       '#F44336',
  devices:      '#3F51B5',
  support:      '#2196F3',
  privacyPolicy:'#4CAF50',
  terms:        '#795548',
  version:      '#607D8B',
  signOut:      '#F44336',
  deleteAcct:   '#B71C1C',
} as const;

// Public legal pages (opened in the system browser).
const PRIVACY_POLICY_URL = 'https://offlinesms.com/offlinesms-privacy-policy.html';
const TERMS_OF_SERVICE_URL = 'https://offlinesms.com/offlinesms-terms-of-service.html';

// App version shown in Settings. Sourced from the .env file
// (EXPO_PUBLIC_APP_VERSION); falls back to the bundled app.json version.
const BUNDLED_VERSION: string = require('../../app.json').expo?.version ?? '0.0.0';
const APP_VERSION: string = (process.env.EXPO_PUBLIC_APP_VERSION ?? '').trim() || BUNDLED_VERSION;

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
  const [profile, setProfile]           = useState<{ displayName?: string; username?: string; phoneNumber?: string | null; photoURL?: string | null }>({});
  const [localStats, setLocalStats]     = useState<{ chats: number; messages: number } | null>(null);
  // "Phone number" row (see phoneLinkRow): offered to every email account
  // without a number; reads "Not available yet" while the server has linking
  // switched off. Refreshed whenever Settings regains focus.
  const [phoneLink, setPhoneLink]       = useState<PhoneLinkStatus | null>(null);
  // Sign-in methods (Email + Phone number), as the server's Auth record has them.
  const [methods, setMethods]           = useState<SignInMethods | null>(null);
  useEffect(() => {
    if (!me) return;
    let active = true;
    const refresh = () => {
      getPhoneLinkStatus().then(st => { if (active) setPhoneLink(st); }).catch(() => { if (active) setPhoneLink(null); });
      getSignInMethods().then(m => { if (active) setMethods(m); }).catch(() => { if (active) setMethods(null); });
    };
    refresh();
    const unsub = navigation.addListener('focus', refresh);
    return () => { active = false; unsub(); };
  }, [me, navigation]);
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
      setProfile({ displayName: m?.displayName, username: m?.username, phoneNumber: m?.phoneNumber, photoURL: m?.photoURL });
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

  async function openUrl(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('settings.linkOpenFailed'), url);
    }
  }

  const s = buildStyles(colors, isRTL);

  const phone = methods?.phone || profile.phoneNumber || auth.currentUser?.phoneNumber || '';
  const phoneRow = phoneLinkRow(phoneLink, { hasEmail: !!auth.currentUser?.email, phone: phoneLink?.available ? null : phone });
  const [emailRow, phoneMethodRow] = signInMethodRows(methods, auth.currentUser ?? {});
  const handle = profile.username ? `@${profile.username}` : '';
  const headerSub = [phone, handle].filter(Boolean).join(' • ') || t('settings.editProfileHint');

  function iconChip(color: string, icon: keyof typeof Ionicons.glyphMap) {
    return (
      <View style={[s.iconChip, { backgroundColor: color }]}>
        <Ionicons name={icon} size={17} color="#fff" />
      </View>
    );
  }

  function navRow(opts: {
    icon: keyof typeof Ionicons.glyphMap; color: string;
    label: string; sub?: string; onPress: () => void;
    first?: boolean; danger?: boolean; hint?: string;
  }) {
    return (
      <Pressable
        style={[s.cardRow, !opts.first && s.cardRowDivider]}
        onPress={opts.onPress}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={opts.label}
        accessibilityHint={opts.hint}
      >
        {iconChip(opts.color, opts.icon)}
        <View style={{ flex: 1 }}>
          <Text style={[s.title, opts.danger && { color: colors.state.error }]} numberOfLines={1}>{opts.label}</Text>
          {opts.sub ? <Text style={s.sub} numberOfLines={1}>{opts.sub}</Text> : null}
        </View>
        {!opts.danger ? <Text style={s.chev} accessibilityElementsHidden>{isRTL ? '‹' : '›'}</Text> : null}
      </Pressable>
    );
  }

  async function doDeleteAccount() {
    setBusy(true);
    try {
      await deleteMyAccount();
      // onAuthStateChanged clears the session and routes back to Welcome.
    } catch {
      setBusy(false);
      Alert.alert(t('settings.deleteAccount'), t('settings.deleteAccountError'));
    }
  }
  function confirmDeleteAccount() {
    if (busy) return;
    Alert.alert(
      t('settings.deleteAccountConfirmTitle'),
      t('settings.deleteAccountConfirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('settings.deleteAccountConfirmButton'), style: 'destructive', onPress: () => { void doDeleteAccount(); } },
      ],
    );
  }

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.content}
      accessibilityLabel={t('settings.title')}
    >

      {/* Centered profile header — big avatar, name, phone • username */}
      <Pressable
        style={s.header}
        onPress={() => navigation.navigate('EditProfile')}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={t('settings.profile')}
      >
        <View style={s.headerAvWrap}>
          <View style={s.headerAv}>
            {profile.photoURL
              ? <Image source={{ uri: profile.photoURL }} style={s.headerAvImg} />
              : <Text style={s.headerAvText}>{profileInitials(profile.displayName)}</Text>}
          </View>
          <View style={s.cameraBadge}>
            <Ionicons name="camera" size={15} color="#fff" />
          </View>
        </View>
        <Text style={s.headerName} numberOfLines={1}>{profile.displayName || t('settings.profile')}</Text>
        <Text style={s.headerSub} numberOfLines={1}>{headerSub}</Text>
      </Pressable>

      {/* Account & security */}
      <View style={s.card}>
        {navRow({ icon: 'person-add', color: CHIP.findFriends, label: t('settings.findFriends'), onPress: () => navigation.navigate('FindFriends'), first: true })}
        {/* Sign-in methods: both always shown — "Add" when missing, "Edit" when present. */}
        {navRow({
          icon: 'mail', color: CHIP.email, label: t('signInMethods.email'),
          sub: methods?.emailChange.pendingRecovery ? t('emailChange.settingsRowRecover')
            : emailRow.value ? `${emailRow.value}  ·  ${t('signInMethods.edit')}` : `${t('signInMethods.notAdded')}  ·  ${t('signInMethods.add')}`,
          onPress: () => navigation.navigate('ChangeEmail'),
          hint: t(emailRow.action === 'add' ? 'signInMethods.addEmailHint' : 'signInMethods.editEmailHint'),
        })}
        {navRow({
          icon: 'call', color: CHIP.phone, label: t('phoneLink.settingsRow'),
          sub: phoneRow === 'recover' ? t('phoneLink.settingsRowRecover')
            : phoneMethodRow.value ? `${formatOwnPhone(phoneMethodRow.value)}  ·  ${t('signInMethods.edit')}`
              : phoneRow === 'unavailable' ? `${t('signInMethods.notAdded')}  ·  ${t('phoneLink.settingsRowUnavailable')}`
                : `${t('signInMethods.notAdded')}  ·  ${t('signInMethods.add')}`,
          onPress: () => navigation.navigate('LinkPhone', { mode: phoneMethodRow.action === 'edit' ? 'change' : 'add' }),
          hint: t(phoneMethodRow.action === 'add' ? 'signInMethods.addPhoneHint' : 'signInMethods.editPhoneHint'),
        })}
        {navRow({ icon: 'key', color: CHIP.securityPin, label: t('settings.securityPin'), onPress: () => navigation.navigate('CreatePin') })}
        {navRow({ icon: 'shield-checkmark', color: CHIP.permissions, label: t('settings.permissions'), onPress: () => navigation.navigate('Permissions') })}
      </View>

      {/* Points + notification toggles */}
      <View style={s.card}>
        {navRow({
          icon: 'star', color: CHIP.points,
          label: t('settings.points'),
          sub: wallet
            ? `${wallet.balance.toLocaleString()} pts  ·  ${wallet.reserved.toLocaleString()} ${t('points.reserved').toLowerCase()}`
            : t('settings.pointsSubtitle'),
          onPress: () => navigation.navigate('Points'),
          first: true,
          hint: t('settings.pointsSubtitle'),
        })}

        <View style={[s.cardRow, s.cardRowDivider]}>
          {iconChip(CHIP.smsReminders, 'chatbox-ellipses')}
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

        <View style={[s.cardRow, s.cardRowDivider]}>
          {iconChip(CHIP.inAppNotifs, 'notifications')}
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
      </View>

      {/* Appearance — wallpaper + notification settings */}
      <View style={s.card}>
        {navRow({ icon: 'image', color: CHIP.wallpaper, label: 'Chat wallpaper', onPress: () => (navigation as any).navigate('ChatWallpaper'), first: true })}
        {navRow({ icon: 'notifications-circle', color: CHIP.notifs, label: 'Notifications', onPress: () => (navigation as any).navigate('NotificationSettings') })}
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

      {/* Linked devices */}
      <View style={s.card}>
        {navRow({ icon: 'laptop', color: CHIP.devices, label: t('settings.linkedDevices'), onPress: () => navigation.navigate('Devices'), first: true })}
      </View>

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
      <View style={s.card}>
        {navRow({ icon: 'help-circle', color: CHIP.support, label: t('settings.helpSupport'), onPress: () => navigation.navigate('SupportTicket'), first: true })}
      </View>

      {/* Legal — public privacy policy & terms of service (open in browser) */}
      <View style={s.card}>
        {navRow({
          icon: 'shield-checkmark', color: CHIP.privacyPolicy,
          label: t('settings.privacyPolicy'),
          onPress: () => openUrl(PRIVACY_POLICY_URL),
          first: true,
          hint: t('settings.opensInBrowser'),
        })}
        {navRow({
          icon: 'document-text', color: CHIP.terms,
          label: t('settings.termsOfService'),
          onPress: () => openUrl(TERMS_OF_SERVICE_URL),
          hint: t('settings.opensInBrowser'),
        })}
      </View>

      {/* Danger zone — permanent account deletion */}
      <View style={s.card}>
        {navRow({
          icon: 'trash',
          color: CHIP.deleteAcct,
          label: t('settings.deleteAccount'),
          sub: t('settings.deleteAccountSubtitle'),
          onPress: confirmDeleteAccount,
          first: true,
          danger: true,
        })}
      </View>

      {/* App version + sign out — bottom of the list */}
      <View style={s.card}>
        <View
          style={s.cardRow}
          accessible={true}
          accessibilityLabel={`${t('settings.appVersion')} ${APP_VERSION}`}
        >
          {iconChip(CHIP.version, 'information-circle')}
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{t('settings.appVersion')}</Text>
          </View>
          <Text style={s.sub}>{APP_VERSION}</Text>
        </View>
        {navRow({ icon: 'log-out', color: CHIP.signOut, label: t('settings.signOut'), onPress: () => signOut(), danger: true })}
      </View>
    </ScrollView>
  );
}

function buildStyles(colors: any, rtl: boolean) {
  return StyleSheet.create({
    root:         { flex: 1, backgroundColor: colors.background.app },
    content:      { padding: 14, paddingBottom: 150, gap: 12 },

    // Centered Telegram-style profile header.
    header:       { alignItems: 'center', paddingTop: 36, paddingBottom: 10 },
    headerAvWrap: { width: 112, height: 112 },
    headerAv:     { width: 112, height: 112, borderRadius: 56, backgroundColor: colors.action.primary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    headerAvImg:  { width: 112, height: 112, borderRadius: 56 },
    headerAvText: { color: colors.action.primaryFg, fontWeight: '800', fontSize: 36 },
    cameraBadge:  { position: 'absolute', bottom: 2, right: rtl ? undefined : 2, left: rtl ? 2 : undefined, width: 32, height: 32, borderRadius: 16, backgroundColor: colors.action.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.background.app },
    headerName:   { fontSize: 24, fontWeight: '800', color: colors.text.primary, marginTop: 14, textAlign: 'center', maxWidth: '90%' },
    headerSub:    { fontSize: 14, color: colors.text.muted, marginTop: 4, textAlign: 'center', maxWidth: '90%' },

    // Grouped cards with icon-chip rows.
    card:         { backgroundColor: colors.background.surface, borderRadius: radius.md, overflow: 'hidden' },
    cardRow:      { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 14, gap: 12 },
    cardRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border.subtle },
    iconChip:     { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },

    title:        { fontSize: 15, fontWeight: '600', color: colors.text.primary, textAlign: rtl ? 'right' : 'left', lineHeight: 20 },
    sub:          { fontSize: 12, color: colors.text.muted, marginTop: 2, textAlign: rtl ? 'right' : 'left', lineHeight: 16 },
    chev:         { fontSize: 18, color: colors.text.disabled, fontWeight: '700' },

    section:      { backgroundColor: colors.background.surface, borderRadius: radius.md, padding: 14 },
    sectionLabel: { fontSize: 12, fontWeight: '700', color: colors.text.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: rtl ? 'right' : 'left' },
    chipRow:      { flexDirection: rtl ? 'row-reverse' : 'row', gap: 8, flexWrap: 'wrap' },
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
