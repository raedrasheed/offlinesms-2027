/** Server retention is independent of device history and disappearing messages. */
export const DEFAULT_MESSAGE_RETENTION_DAYS = 14;
export const MAX_MESSAGE_RETENTION_DAYS = 3650;
export const DAY_MS = 86_400_000;
export function validRetentionDays(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_MESSAGE_RETENTION_DAYS;
}
export function retentionPolicy(data: Record<string, any> = {}) {
  const days = data.messageRetentionDays ?? DEFAULT_MESSAGE_RETENTION_DAYS;
  if (!validRetentionDays(days)) throw new Error('invalid-message-retention-days');
  // Deployment does not unexpectedly purge an existing production history.
  return { days, enabled: data.messageRetentionEnabled === true };
}
export function retentionCutoff(now: number, days: number): number {
  if (!validRetentionDays(days)) throw new Error('invalid-message-retention-days');
  return now - days * DAY_MS;
}
export function chatMessagePath(path: string): boolean {
  return /^conversations\/[^/]+\/messages\/[^/]+$/.test(path);
}
export function ownedMediaPrefix(path: string, msg: Record<string, any>): string | null {
  const uid = msg.senderUid ?? msg.senderId;
  if (!chatMessagePath(path) || !['image', 'voice', 'file', 'video', 'audio'].includes(msg.type) || typeof uid !== 'string' || !uid || uid.includes('/')) return null;
  const [, conversationId, , messageId] = path.split('/');
  return `chatMedia/${conversationId}/${uid}/${messageId}/`;
}
