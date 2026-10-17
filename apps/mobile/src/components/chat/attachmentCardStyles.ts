import { StyleSheet } from 'react-native';

export const ATTACHMENT_SENT = '#D9FDD3';
export const ATTACHMENT_READ = '#34B7F1';
export function attachmentCardWidth(windowWidth: number, map = false): number {
  return Math.max(120, Math.min(map ? 274 : 336, (windowWidth - 24) * 0.86, windowWidth - 70));
}
export const attachmentCardStyles = StyleSheet.create({
  card: { direction: 'ltr', overflow: 'hidden', borderRadius: 7 },
  receipt: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4, paddingHorizontal: 8, minHeight: 20, paddingBottom: 3 },
});
