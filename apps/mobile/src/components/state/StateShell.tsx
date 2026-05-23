// Shared shell for mobile state primitives.
//
// Mirrors the dashboard primitives in shape so screens move between platforms
// without rewriting state UX. Colors come from the semantic token layer.

import { ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, I18nManager } from 'react-native';
import { semantic, typography, radius } from '@offlinesms/design-tokens';

export type StateAction = {
  label: string;
  onPress?: () => void;
};

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

export type StateShellProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  primaryAction?: StateAction;
  secondaryAction?: StateAction;
  compact?: boolean;
  fullPage?: boolean;
  tone?: Tone;
  /** Render an ActivityIndicator inside the icon slot. */
  spinner?: boolean;
};

const toneColor: Record<Tone, string> = {
  neutral: semantic.color.action.subtleFg,
  info:    semantic.color.action.subtleFg,
  success: semantic.color.state.success,
  warning: semantic.color.state.warning,
  error:   semantic.color.state.error,
};

const toneBg: Record<Tone, string> = {
  neutral: semantic.color.action.subtle,
  info:    semantic.color.action.subtle,
  success: '#DCFCE7',
  warning: '#FEF3C7',
  error:   '#FEE2E2',
};

export function StateShell({
  title,
  description,
  icon,
  primaryAction,
  secondaryAction,
  compact,
  fullPage,
  tone = 'neutral',
  spinner,
}: StateShellProps) {
  const writingAlign = I18nManager.isRTL ? 'right' : 'center';
  return (
    <View
      style={[
        styles.root,
        compact ? styles.compact : styles.full,
        fullPage && styles.fullPage,
      ]}
    >
      {(icon || spinner) && (
        <View style={[styles.iconBubble, { backgroundColor: toneBg[tone] }]}>
          {spinner
            ? <ActivityIndicator color={toneColor[tone]} />
            : icon
          }
        </View>
      )}
      <Text style={[styles.title, { textAlign: writingAlign as any }]}>{title}</Text>
      {description ? (
        <Text style={[styles.description, { textAlign: writingAlign as any }]}>{description}</Text>
      ) : null}
      {(primaryAction || secondaryAction) ? (
        <View style={styles.actions}>
          {primaryAction ? (
            <Pressable style={styles.primaryBtn} onPress={primaryAction.onPress}>
              <Text style={styles.primaryLabel}>{primaryAction.label}</Text>
            </Pressable>
          ) : null}
          {secondaryAction ? (
            <Pressable style={styles.secondaryBtn} onPress={secondaryAction.onPress}>
              <Text style={styles.secondaryLabel}>{secondaryAction.label}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  compact: { paddingVertical: 16 },
  full: { paddingVertical: 40 },
  fullPage: { flex: 1 },
  iconBubble: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700',
    color: semantic.color.text.primary,
    marginTop: 4,
  },
  description: {
    fontSize: typography.fontSize.sm,
    color: semantic.color.text.muted,
    maxWidth: 360,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  primaryBtn: {
    backgroundColor: semantic.color.action.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  primaryLabel: {
    color: semantic.color.action.primaryFg,
    fontWeight: '700',
    fontSize: typography.fontSize.sm,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: semantic.color.border.default,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  secondaryLabel: {
    color: semantic.color.text.secondary,
    fontWeight: '600',
    fontSize: typography.fontSize.sm,
  },
});
