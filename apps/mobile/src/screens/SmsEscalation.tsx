import {CheckmarkIcon} from '../components/CheckmarkIcon';
// OfflineSMS escalation flow.
//
// One screen with five internal steps:
//   audience → recipients → text → confirm → result
//
// The wallet balance, eligible/excluded recipient breakdown, and points
// cost all come from previewSmsEscalation (read-only). On confirm the
// screen calls escalateSms; the result step renders the OfflineSMS
// Delivery Report directly from the callable's response.

import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, Switch, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  buildDefaultSmsBody,
  escalateSms,
  previewSmsEscalation,
  retryFailedSmsRecipients,
  smsErrorCopy,
  smsErrorReason,
  smsPreviewErrorCopy,
  smsSkipReasonCopy,
  EligibleRecipient,
  EscalationAudience,
  EscalationPreview,
  EscalationResult,
  ExcludedRecipient,
} from '../lib/sms';
import { colors, radius } from '../theme';
import { useDisplayName } from '../lib/userProfiles';
import { LoadingState, ErrorState, EmptyState } from '../components/state';

type Step = 'audience' | 'recipients' | 'text' | 'confirm' | 'sending' | 'result';

export default function SmsEscalation({ route, navigation }: any) {
  const params = (route.params ?? {}) as {
    conversationId?: string;
    messageId?:      string;
    messageText?:    string;
  };
  if (!params.conversationId || !params.messageId) {
    return (
      <View style={s.root}>
        <View style={s.header}>
          <Pressable onPress={() => navigation.goBack()}><Text style={s.back}>‹</Text></Pressable>
          <Text style={s.title}>Send via OfflineSMS</Text>
        </View>
        <ErrorState fullPage title="Missing context" description="Open SMS escalation from a specific message." />
      </View>
    );
  }
  const conversationId: string = params.conversationId;
  const messageId:      string = params.messageId;
  const messageText:    string | undefined = params.messageText;

  const [conversationName, setConversationName] = useState<string>('OfflineSMS');
  const [audience, setAudience] = useState<EscalationAudience>('unread_only');
  const [preview, setPreview]   = useState<EscalationPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr]   = useState<string | null>(null);

  const [smsBody, setSmsBody]     = useState(buildDefaultSmsBody(messageText));
  const [confirmed, setConfirmed] = useState(false);
  const [step, setStep]           = useState<Step>('audience');

  const [result, setResult]   = useState<EscalationResult | null>(null);
  const [resultErr, setResultErr] = useState<string | null>(null);

  // Track the conversation name (groups) for display. The SMS body defaults to
  // the original message and is owned by the user once editable, so it isn't
  // re-set here.
  useEffect(() => {
    return onSnapshot(doc(db, 'conversations', conversationId), snap => {
      const data = snap.data() as { name?: string; type?: string } | undefined;
      if (data?.name) setConversationName(data.name);
    });
  }, [conversationId]);

  // Re-run preview whenever audience changes (or the user taps Retry, which
  // bumps previewAttempt).
  const [previewAttempt, setPreviewAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setPreviewBusy(true); setPreviewErr(null);
    previewSmsEscalation({ conversationId, messageId, audience })
      .then(p => { if (!cancelled) setPreview(p); })
      .catch(e => {
        if (cancelled) return;
        setPreview(null);
        setPreviewErr(smsPreviewErrorCopy(e));
      })
      .finally(() => { if (!cancelled) setPreviewBusy(false); });
    return () => { cancelled = true; };
  }, [conversationId, messageId, audience, previewAttempt]);

  const segments = useMemo(() => {
    if (smsBody.length === 0) return 0;
    // GSM-7 ~160 chars per segment; Unicode ~70. Use a conservative 70-cap.
    const isUnicode = /[^ -~]/.test(smsBody);
    return Math.ceil(smsBody.length / (isUnicode ? 70 : 160));
  }, [smsBody]);

  const remaining = preview ? preview.walletBalance - preview.pointsCost : 0;
  const enoughPoints = preview ? preview.walletBalance >= preview.pointsCost : true;
  const canConfirm = !!preview && preview.eligibleCount > 0 && enoughPoints && confirmed && smsBody.trim().length > 0;

  async function submit() {
    if (!canConfirm || !preview) return;
    setStep('sending'); setResultErr(null);
    try {
      const r = await escalateSms({ conversationId, messageId, audience, smsBody: smsBody.trim() });
      setResult(r);
      setStep('result');
    } catch (e: any) {
      setResultErr(smsPreviewErrorCopy(e));
      setStep('confirm');
    }
  }

  async function retry() {
    if (!result) return;
    try {
      const r = await retryFailedSmsRecipients(result.batchId);
      Alert.alert('Retried', `${r.sent} sent · ${r.failed} failed`);
    } catch (e: any) {
      Alert.alert('Couldn’t retry', smsErrorCopy(e?.code ?? 'internal'));
    }
  }

  // ── Render by step ────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.root}>
      <Header onBack={() => navigation.goBack()} title="Send via OfflineSMS" />
      <Stepper step={step} />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        {step === 'audience' ? (
          <AudienceStep
            audience={audience}
            preview={preview}
            previewBusy={previewBusy}
            previewErr={previewErr}
            onPick={a => setAudience(a)}
            onRetryPreview={() => setPreviewAttempt(n => n + 1)}
            onContinue={() => preview && preview.eligibleCount > 0 ? setStep('recipients') : null}
          />
        ) : null}

        {step === 'recipients' ? (
          <RecipientsStep
            preview={preview}
            onBack={() => setStep('audience')}
            onContinue={() => setStep('text')}
          />
        ) : null}

        {step === 'text' ? (
          <TextStep
            smsBody={smsBody}
            setSmsBody={setSmsBody}
            segments={segments}
            recipientCount={preview?.eligibleCount ?? 0}
            onBack={() => setStep('recipients')}
            onContinue={() => setStep('confirm')}
          />
        ) : null}

        {step === 'confirm' ? (
          <ConfirmStep
            preview={preview}
            smsBody={smsBody}
            segments={segments}
            remaining={remaining}
            enoughPoints={enoughPoints}
            confirmed={confirmed}
            setConfirmed={setConfirmed}
            resultErr={resultErr}
            canSubmit={canConfirm}
            onBack={() => setStep('text')}
            onSubmit={submit}
          />
        ) : null}

        {step === 'sending' ? (
          <LoadingState fullPage title="Sending via OfflineSMS…" description="This usually takes a few seconds." />
        ) : null}

        {step === 'result' && result ? (
          <ResultStep
            result={result}
            preview={preview}
            onRetry={result.failed > 0 ? retry : null}
            onClose={() => navigation.popToTop()}
            onViewReport={() => navigation.navigate('SmsBatchReport', { batchId: result.batchId })}
          />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Sub-views ──────────────────────────────────────────────────────

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <View style={s.header}>
      <Pressable onPress={onBack}><Text style={s.back}>‹</Text></Pressable>
      <Text style={s.title}>{title}</Text>
    </View>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: 'audience',   label: 'Audience' },
    { key: 'recipients', label: 'Recipients' },
    { key: 'text',       label: 'Text' },
    { key: 'confirm',    label: 'Confirm' },
  ];
  if (step === 'sending' || step === 'result') return null;
  const idx = steps.findIndex(s => s.key === step);
  return (
    <View style={s.stepper}>
      {steps.map((sv, i) => (
        <View key={sv.key} style={s.stepperItem}>
          <View style={[s.stepperDot, i <= idx && s.stepperDotOn]}>
            <Text style={[s.stepperDotText, i <= idx && s.stepperDotTextOn]}>{i + 1}</Text>
          </View>
          <Text style={[s.stepperLabel, i === idx && s.stepperLabelOn]}>{sv.label}</Text>
        </View>
      ))}
    </View>
  );
}

function AudienceStep({
  audience, preview, previewBusy, previewErr, onPick, onRetryPreview, onContinue,
}: {
  audience: EscalationAudience;
  preview: EscalationPreview | null;
  previewBusy: boolean;
  previewErr: string | null;
  onPick: (a: EscalationAudience) => void;
  onRetryPreview: () => void;
  onContinue: () => void;
}) {
  const cards: Array<{ key: EscalationAudience; title: string; description: string }> = [
    { key: 'unread_only',       title: 'People who have not read',  description: 'Recipients who received it but haven’t read yet.' },
    { key: 'undelivered_only',  title: 'People who did not receive', description: 'Recipients still pending or where delivery failed.' },
    { key: 'everyone',          title: 'Everyone',                   description: 'Send to every eligible recipient.' },
  ];
  return (
    <View>
      <Text style={s.sectionLabel}>Audience</Text>
      <Text style={s.sectionSub}>OfflineSMS will send a reminder via SMS using OfflineSMS Points.</Text>
      {cards.map(c => {
        const on = audience === c.key;
        return (
          <Pressable key={c.key} style={[s.audienceCard, on && s.audienceCardOn]} onPress={() => onPick(c.key)}>
            <View style={{ flex: 1 }}>
              <Text style={[s.audienceTitle, on && { color: colors.primaryDark }]}>{c.title}</Text>
              <Text style={s.audienceDesc}>{c.description}</Text>
            </View>
            <View style={[s.audienceRadio, on && s.audienceRadioOn]} />
          </Pressable>
        );
      })}

      <Text style={s.sectionLabel}>Preview</Text>
      {previewBusy ? (
        <LoadingState compact title="Loading preview…" />
      ) : previewErr ? (
        <>
          <ErrorState compact title="Preview failed" description={previewErr} />
          <Pressable style={s.secondaryBtn} onPress={onRetryPreview}>
            <Text style={s.secondaryBtnText}>Retry preview</Text>
          </Pressable>
        </>
      ) : preview ? (
        <View style={s.statsGrid}>
          <Stat label="Eligible" value={preview.eligibleCount} />
          <Stat label="Excluded" value={preview.excludedCount} />
          <Stat label="Points"   value={preview.pointsCost} />
          <Stat label="Balance"  value={preview.walletBalance} />
        </View>
      ) : null}

      <Pressable
        style={[s.primaryBtn, (!preview || preview.eligibleCount === 0) && { opacity: 0.4 }]}
        onPress={onContinue}
        disabled={!preview || preview.eligibleCount === 0}
      >
        <Text style={s.primaryBtnText}>Continue</Text>
      </Pressable>
      {preview && preview.eligibleCount === 0 ? (
        <Text style={s.foot}>No eligible recipients for this audience.</Text>
      ) : null}
    </View>
  );
}

function RecipientsStep({
  preview, onBack, onContinue,
}: {
  preview: EscalationPreview | null;
  onBack: () => void;
  onContinue: () => void;
}) {
  if (!preview) return <LoadingState fullPage title="Loading…" />;
  return (
    <View>
      <Text style={s.sectionLabel}>Eligible recipients ({preview.eligibleCount})</Text>
      {preview.eligibleRecipients.length === 0 ? (
        <EmptyState compact title="No eligible recipients" />
      ) : (
        preview.eligibleRecipients.map(r => <EligibleRow key={r.uid} r={r} />)
      )}

      {preview.excludedRecipients.length > 0 ? (
        <>
          <Text style={s.sectionLabel}>Excluded ({preview.excludedCount})</Text>
          {preview.excludedRecipients.map(r => <ExcludedRow key={r.uid} r={r} />)}
        </>
      ) : null}

      <View style={s.row}>
        <Pressable style={s.secondaryBtn} onPress={onBack}><Text style={s.secondaryBtnText}>Back</Text></Pressable>
        <Pressable
          style={[s.primaryBtn, { flex: 1 }, preview.eligibleCount === 0 && { opacity: 0.4 }]}
          onPress={onContinue}
          disabled={preview.eligibleCount === 0}
        >
          <Text style={s.primaryBtnText}>Continue</Text>
        </Pressable>
      </View>
    </View>
  );
}

function TextStep({
  smsBody, setSmsBody, segments, recipientCount, onBack, onContinue,
}: {
  smsBody: string;
  setSmsBody: (v: string) => void;
  segments: number;
  recipientCount: number;
  onBack: () => void;
  onContinue: () => void;
}) {
  const tooLong = smsBody.length > 320;
  const isUnicode = /[^ -~]/.test(smsBody);
  return (
    <View>
      <Text style={s.sectionLabel}>SMS text</Text>
      <TextInput
        style={s.textArea}
        value={smsBody}
        onChangeText={setSmsBody}
        multiline
        maxLength={320}
      />
      <View style={s.metaRow}>
        <Text style={s.foot}>{smsBody.length}/320 chars · {segments} segment{segments === 1 ? '' : 's'}</Text>
        {isUnicode ? <Text style={s.foot}>Unicode / Arabic encoding</Text> : null}
      </View>
      <Text style={s.foot}>Sending to {recipientCount} recipient{recipientCount === 1 ? '' : 's'}.</Text>

      <View style={s.row}>
        <Pressable style={s.secondaryBtn} onPress={onBack}><Text style={s.secondaryBtnText}>Back</Text></Pressable>
        <Pressable
          style={[s.primaryBtn, { flex: 1 }, (tooLong || smsBody.trim().length === 0) && { opacity: 0.4 }]}
          onPress={onContinue}
          disabled={tooLong || smsBody.trim().length === 0}
        >
          <Text style={s.primaryBtnText}>Continue</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ConfirmStep({
  preview, smsBody, segments, remaining, enoughPoints, confirmed, setConfirmed,
  resultErr, canSubmit, onBack, onSubmit,
}: {
  preview: EscalationPreview | null;
  smsBody: string;
  segments: number;
  remaining: number;
  enoughPoints: boolean;
  confirmed: boolean;
  setConfirmed: (v: boolean) => void;
  resultErr: string | null;
  canSubmit: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  if (!preview) return null;
  return (
    <View>
      <Text style={s.sectionLabel}>Confirm</Text>

      <View style={s.card}>
        <Text style={s.cardLabel}>SMS preview</Text>
        <Text style={s.cardBody} numberOfLines={6}>{smsBody}</Text>
        <Text style={s.foot}>{segments} segment{segments === 1 ? '' : 's'}</Text>
      </View>

      <View style={s.statsGrid}>
        <Stat label="Recipients" value={preview.eligibleCount} />
        <Stat label="Cost"       value={preview.pointsCost} />
      </View>
      <View style={s.statsGrid}>
        <Stat label="Balance"    value={preview.walletBalance} />
        <Stat label="Reserved"   value={preview.walletReserved} />
        <Stat label="Available"  value={Math.max(0, preview.walletBalance - preview.walletReserved)} />
        <Stat label="Remaining"  value={remaining} />
      </View>

      {!enoughPoints ? (
        <View style={[s.notice, { borderColor: colors.err, backgroundColor: '#FEF2F2' }]}>
          <Text style={[s.noticeText, { color: colors.err }]}>Not enough OfflineSMS Points.</Text>
        </View>
      ) : null}

      <Pressable style={s.confirmRow} onPress={() => setConfirmed(!confirmed)}>
        <View style={[s.checkbox, confirmed && s.checkboxOn]}>{confirmed ? <CheckmarkIcon color="#FFFFFF" size={15}/> : null}</View>
        <Text style={s.confirmText}>I confirm these recipients may be contacted by SMS.</Text>
      </Pressable>

      {resultErr ? <ErrorState compact title="Couldn’t send" description={resultErr} /> : null}

      <View style={s.row}>
        <Pressable style={s.secondaryBtn} onPress={onBack}><Text style={s.secondaryBtnText}>Back</Text></Pressable>
        <Pressable
          style={[s.primaryBtn, { flex: 1 }, !canSubmit && { opacity: 0.4 }]}
          onPress={onSubmit}
          disabled={!canSubmit}
        >
          <Text style={s.primaryBtnText}>Send SMS for {preview.pointsCost} points</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ResultStep({
  result, preview, onRetry, onClose, onViewReport,
}: {
  result: EscalationResult;
  preview: EscalationPreview | null;
  onRetry: (() => void) | null;
  onClose: () => void;
  onViewReport: () => void;
}) {
  return (
    <View>
      <Text style={s.sectionLabel}>OfflineSMS Delivery Report</Text>

      <View style={s.statsGrid}>
        <Stat label="Sent"     value={result.sent} />
        <Stat label="Failed"   value={result.failed} />
        <Stat label="Skipped"  value={result.skipped} />
        <Stat label="Points"   value={result.pointsCost} />
      </View>

      <View style={s.card}>
        <Text style={s.cardLabel}>OfflineSMS batch ID</Text>
        <Text style={s.cardBody}>{result.offlineSmsBatchId ?? result.batchId}</Text>
      </View>

      <View style={s.card}>
        <Text style={s.cardLabel}>Status</Text>
        <Text style={s.cardBody}>
          {result.status === 'accepted' ? 'Sent to OfflineSMS Gateway' :
           result.status === 'partial'  ? 'Partial failure' :
           'Failed'}
        </Text>
      </View>

      {preview?.excludedRecipients.length ? (
        <>
          <Text style={s.sectionLabel}>Excluded ({preview.excludedCount})</Text>
          {preview.excludedRecipients.map(r => <ExcludedRow key={r.uid} r={r} />)}
        </>
      ) : null}

      <Pressable style={s.primaryBtn} onPress={onViewReport}>
        <Text style={s.primaryBtnText}>View OfflineSMS Delivery Report</Text>
      </Pressable>

      <View style={s.row}>
        {onRetry ? (
          <Pressable style={[s.secondaryBtn, { flex: 1 }]} onPress={onRetry}>
            <Text style={s.secondaryBtnText}>Retry failed</Text>
          </Pressable>
        ) : null}
        <Pressable style={[s.secondaryBtn, { flex: 1 }]} onPress={onClose}>
          <Text style={s.secondaryBtnText}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={s.statCard}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function EligibleRow({ r }: { r: EligibleRecipient }) {
  const name = useDisplayName(r.uid, { snapshot: r.displayName });
  return (
    <View style={s.recipientRow}>
      <View style={s.avatar}><Text style={s.avatarText}>{name.replace(/^@/, '').slice(0, 1).toUpperCase()}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={s.recipientName}>{name}</Text>
        <Text style={s.recipientPhone}>{r.maskedPhone}</Text>
      </View>
      <View style={[s.pill, { backgroundColor: '#DCFCE7' }]}>
        <Text style={[s.pillText, { color: '#166534' }]}>{r.appReceiptStatus ?? 'pending'}</Text>
      </View>
    </View>
  );
}

function ExcludedRow({ r }: { r: ExcludedRecipient }) {
  const name = useDisplayName(r.uid, { snapshot: r.displayName });
  return (
    <View style={s.recipientRow}>
      <View style={[s.avatar, { backgroundColor: colors.ink200 }]}><Text style={[s.avatarText, { color: colors.ink700 }]}>{name.replace(/^@/, '').slice(0, 1).toUpperCase()}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={s.recipientName}>{name}</Text>
        <Text style={s.recipientPhone}>{smsSkipReasonCopy(r.skipReason)}</Text>
      </View>
      <View style={[s.pill, { backgroundColor: '#FEF3C7' }]}>
        <Text style={[s.pillText, { color: '#A16207' }]}>Excluded</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bgCanvas },
  header:  { paddingTop: 50, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back:    { fontSize: 24, color: colors.primary },
  title:   { fontSize: 14, fontWeight: '700', color: colors.ink },
  stepper: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12, paddingHorizontal: 14, backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.ink100 },
  stepperItem: { alignItems: 'center', flex: 1 },
  stepperDot:  { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.ink200, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  stepperDotOn: { backgroundColor: colors.primary },
  stepperDotText: { color: colors.ink500, fontSize: 11, fontWeight: '700' },
  stepperDotTextOn: { color: '#fff' },
  stepperLabel: { fontSize: 10, color: colors.ink500, fontWeight: '600' },
  stepperLabelOn: { color: colors.ink, fontWeight: '700' },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: colors.ink500, letterSpacing: 0.6, marginTop: 14, marginBottom: 6 },
  sectionSub:   { fontSize: 12, color: colors.ink500, marginBottom: 8 },
  audienceCard: { flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 8, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink200 },
  audienceCardOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  audienceTitle:{ fontSize: 14, fontWeight: '700', color: colors.ink },
  audienceDesc: { fontSize: 12, color: colors.ink500, marginTop: 2 },
  audienceRadio:{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.ink300 },
  audienceRadioOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  statsGrid:    { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statCard:     { flex: 1, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100, padding: 10, alignItems: 'center' },
  statValue:    { fontSize: 20, fontWeight: '800', color: colors.ink },
  statLabel:    { fontSize: 10, fontWeight: '700', color: colors.ink500, marginTop: 2, letterSpacing: 0.4 },
  recipientRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, marginBottom: 4, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100 },
  avatar:       { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText:   { color: colors.primaryDark, fontWeight: '700' },
  recipientName:{ fontSize: 13, color: colors.ink, fontWeight: '700' },
  recipientPhone:{ fontSize: 11, color: colors.ink500, marginTop: 2 },
  pill:         { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText:     { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  textArea:     { padding: 12, backgroundColor: '#fff', borderRadius: radius.md, fontSize: 14, borderWidth: 1, borderColor: colors.ink200, minHeight: 110, textAlignVertical: 'top' },
  metaRow:      { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, marginBottom: 6 },
  foot:         { fontSize: 11, color: colors.ink500, marginTop: 6 },
  row:          { flexDirection: 'row', gap: 8, marginTop: 14 },
  primaryBtn:   { padding: 14, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center', marginTop: 14 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  secondaryBtn: { padding: 14, borderRadius: radius.md, alignItems: 'center', marginTop: 14, borderWidth: 1, borderColor: colors.ink200, backgroundColor: '#fff' },
  secondaryBtnText: { color: colors.ink, fontWeight: '700' },
  card:         { backgroundColor: '#fff', padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100, marginBottom: 12 },
  cardLabel:    { fontSize: 11, fontWeight: '700', color: colors.ink500, marginBottom: 4 },
  cardBody:     { fontSize: 14, color: colors.ink },
  notice:       { padding: 10, borderRadius: radius.md, borderWidth: 1, marginBottom: 8 },
  noticeText:   { fontSize: 12, fontWeight: '700' },
  confirmRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  checkbox:     { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: colors.ink300, alignItems: 'center', justifyContent: 'center' },
  checkboxOn:   { backgroundColor: colors.primary, borderColor: colors.primary },
  confirmText:  { flex: 1, fontSize: 13, color: colors.ink },
});
