// RequestPoints — request a points package from an admin (NO purchase / payment).
//
// The mobile app does NOT sell points. Points are assigned by an organization
// or an OfflineSMS admin. This screen lists the available packages by NAME +
// POINT AMOUNT only (no price, currency, bonus). Tapping a package submits a
// request to the backend (createPointsRequest) — the admin then approves
// (credits the wallet) or rejects it from the dashboard. No checkout, invoice,
// or payment is ever involved.

import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { isRTL } from '../i18n';
import { radius } from '../theme';
import {
  subscribePackages, createPointsRequest, pointsErrorReason, type PointsPackage,
} from '../lib/points';

export default function RequestPoints({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = buildStyles(colors, isRTL);

  const [packages, setPackages] = useState<PointsPackage[] | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  useEffect(() => subscribePackages(setPackages), []);

  function requestErrorCopy(e: unknown): string {
    const reason = pointsErrorReason(e);
    if (reason === 'request-already-pending') return t('points.requestAlreadyPending');
    if (reason === 'package-inactive' || reason === 'package-not-found' || reason === 'package-misconfigured') {
      return t('points.requestPackageUnavailable');
    }
    return t('points.requestErrorGeneric');
  }

  async function submit(pkg: PointsPackage) {
    setSubmittingId(pkg.id);
    try {
      await createPointsRequest(pkg.id);
      Alert.alert(t('points.requestSentTitle'), t('points.requestSentMessage'));
    } catch (e) {
      Alert.alert(t('points.requestFailedTitle'), requestErrorCopy(e));
    } finally {
      setSubmittingId(null);
    }
  }

  function confirmRequest(pkg: PointsPackage) {
    if (submittingId) return;
    Alert.alert(
      t('points.requestConfirmTitle', { name: pkg.name }),
      t('points.requestConfirmMessage', { points: pkg.points.toLocaleString() }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('points.requestCta'), onPress: () => { void submit(pkg); } },
      ],
    );
  }

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 24 }]}
    >
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          accessible
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Ionicons name={isRTL ? 'chevron-forward' : 'chevron-back'} size={24} color={colors.text.primary} />
        </Pressable>
        <Text style={s.title}>{t('points.requestTitle')}</Text>
      </View>

      <View style={s.iconBubble}>
        <Ionicons name="information-circle-outline" size={36} color={colors.action.primary} />
      </View>

      <Text style={s.heading}>{t('points.requestHeading')}</Text>
      <Text style={s.body}>{t('points.requestExplainer')}</Text>

      {packages && packages.length > 0 ? (
        <>
          <Text style={s.sectionLabel}>{t('points.packagesTitle')}</Text>
          {packages.map(p => {
            const submitting = submittingId === p.id;
            return (
              <Pressable
                key={p.id}
                style={[s.packageCard, !!submittingId && !submitting && { opacity: 0.5 }]}
                onPress={() => confirmRequest(p)}
                disabled={!!submittingId}
                accessible
                accessibilityRole="button"
                accessibilityLabel={`${t('points.requestCta')} ${p.name}, ${p.points.toLocaleString()} ${t('points.unit')}`}
              >
                <Text style={s.pkgName}>{p.name}</Text>
                {submitting ? (
                  <ActivityIndicator color={colors.action.primary} />
                ) : (
                  <Text style={s.pkgPoints}>{p.points.toLocaleString()} {t('points.unit')}</Text>
                )}
              </Pressable>
            );
          })}
        </>
      ) : null}

      <Pressable
        style={s.secondaryBtn}
        onPress={() => navigation.navigate('MyPointsRequests')}
        accessible
        accessibilityRole="button"
        accessibilityLabel={t('points.myRequestsTitle')}
      >
        <Ionicons name="time-outline" size={18} color={colors.action.primary} />
        <Text style={s.secondaryBtnText}>{t('points.myRequestsLink')}</Text>
      </Pressable>

      <View style={s.noteCard}>
        <Ionicons name="shield-checkmark-outline" size={18} color={colors.text.muted} />
        <Text style={s.noteText}>{t('points.requestAdminNote')}</Text>
      </View>

      <Pressable
        style={s.primaryBtn}
        onPress={() => navigation.goBack()}
        accessible
        accessibilityRole="button"
        accessibilityLabel={t('common.gotIt')}
      >
        <Text style={s.primaryBtnText}>{t('common.gotIt')}</Text>
      </Pressable>
    </ScrollView>
  );
}

function buildStyles(colors: any, rtl: boolean) {
  return StyleSheet.create({
    root:    { flex: 1, backgroundColor: colors.background.app },
    content: { paddingHorizontal: 20 },
    header:  { paddingBottom: 12, flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 12 },
    title:   { fontSize: 16, fontWeight: '800', color: colors.text.primary },
    secondaryBtn: { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, padding: 14, borderRadius: radius.md, backgroundColor: colors.background.surface, borderWidth: 1, borderColor: colors.action.primary },
    secondaryBtnText: { color: colors.action.primary, fontWeight: '800', fontSize: 14 },
    iconBubble: { alignSelf: 'center', width: 72, height: 72, borderRadius: 36, backgroundColor: colors.action.subtle, alignItems: 'center', justifyContent: 'center', marginTop: 24, marginBottom: 16 },
    heading: { fontSize: 20, fontWeight: '800', color: colors.text.primary, textAlign: 'center' },
    body:    { fontSize: 14, color: colors.text.secondary, lineHeight: 21, textAlign: 'center', marginTop: 10 },
    sectionLabel: { fontSize: 11, fontWeight: '700', color: colors.text.muted, letterSpacing: 0.6, marginTop: 24, marginBottom: 10, textTransform: 'uppercase', textAlign: rtl ? 'right' : 'left' },
    packageCard: { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: colors.background.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.subtle, marginBottom: 8 },
    pkgName:   { fontSize: 15, fontWeight: '700', color: colors.text.primary },
    pkgPoints: { fontSize: 14, fontWeight: '800', color: colors.action.primary, writingDirection: 'ltr' },
    noteCard: { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 10, marginTop: 22, padding: 14, backgroundColor: colors.background.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.subtle },
    noteText: { flex: 1, fontSize: 13, color: colors.text.secondary, lineHeight: 19, textAlign: rtl ? 'right' : 'left' },
    primaryBtn: { marginTop: 28, padding: 16, borderRadius: radius.md, backgroundColor: colors.action.primary, alignItems: 'center' },
    primaryBtnText: { color: colors.action.primaryFg, fontWeight: '800', fontSize: 15 },
  });
}
