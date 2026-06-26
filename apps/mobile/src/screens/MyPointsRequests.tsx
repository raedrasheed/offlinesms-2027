// MyPointsRequests — the signed-in user's points-request history.
//
// Read-only list of the packages the user has requested and each one's status
// (pending / approved / rejected). No payment or purchase anywhere.

import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { auth } from '../lib/firebase';
import { subscribeMyPointsRequests, type PointsRequest, type PointsRequestStatus } from '../lib/points';
import { useTheme } from '../context/ThemeContext';
import { isRTL } from '../i18n';
import { radius } from '../theme';
import { LoadingState, EmptyState } from '../components/state';

function fmtDate(ts: any): string {
  const d: Date | null = ts?.toDate?.() ?? null;
  if (!d) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusColors(status: PointsRequestStatus): { bg: string; fg: string } {
  switch (status) {
    case 'approved': return { bg: '#DCFCE7', fg: '#166534' };
    case 'rejected': return { bg: '#FEE2E2', fg: '#991B1B' };
    default:         return { bg: '#FEF3C7', fg: '#92400E' };   // pending
  }
}

export default function MyPointsRequests({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const me = auth.currentUser?.uid;
  const [rows, setRows] = useState<PointsRequest[] | null>(null);
  const s = buildStyles(colors, isRTL);

  useEffect(() => {
    if (!me) { setRows([]); return; }
    return subscribeMyPointsRequests(me, setRows);
  }, [me]);

  const statusLabel = (status: PointsRequestStatus) =>
    status === 'approved' ? t('points.reqStatus.approved')
      : status === 'rejected' ? t('points.reqStatus.rejected')
      : t('points.reqStatus.pending');

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
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
        <Text style={s.title}>{t('points.myRequestsTitle')}</Text>
      </View>

      <View style={s.padded}>
        {rows === null ? (
          <LoadingState compact title={t('points.loadingRequests')} />
        ) : rows.length === 0 ? (
          <EmptyState compact title={t('points.myRequestsEmpty')} description={t('points.myRequestsEmptyDesc')} />
        ) : (
          rows.map(r => {
            const c = statusColors(r.status);
            return (
              <View key={r.id} style={s.card}>
                <View style={{ flex: 1 }}>
                  <Text style={s.pkgName}>{r.packageName || '—'}</Text>
                  <Text style={s.meta}>{r.points.toLocaleString()} {t('points.unit')} · {fmtDate(r.createdAt)}</Text>
                  {r.status === 'rejected' && r.reviewNote ? (
                    <Text style={s.reviewNote}>{r.reviewNote}</Text>
                  ) : null}
                </View>
                <View style={[s.badge, { backgroundColor: c.bg }]}>
                  <Text style={[s.badgeText, { color: c.fg }]}>{statusLabel(r.status)}</Text>
                </View>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

function buildStyles(colors: any, rtl: boolean) {
  return StyleSheet.create({
    root:    { flex: 1, backgroundColor: colors.background.app },
    header:  { paddingBottom: 12, paddingHorizontal: 14, flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
    title:   { fontSize: 16, fontWeight: '800', color: colors.text.primary },
    padded:  { padding: 14 },
    card:    { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: colors.background.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.subtle, marginBottom: 8 },
    pkgName: { fontSize: 15, fontWeight: '700', color: colors.text.primary, textAlign: rtl ? 'right' : 'left' },
    meta:    { fontSize: 12, color: colors.text.muted, marginTop: 3, textAlign: rtl ? 'right' : 'left' },
    reviewNote: { fontSize: 12, color: colors.text.secondary, marginTop: 6, fontStyle: 'italic', textAlign: rtl ? 'right' : 'left' },
    badge:    { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
    badgeText:{ fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  });
}
