// Phase 22C — Firestore → local message feeder for the open conversation.
//
// When local-first conversation mode is on, the screen does NOT subscribe to
// Firestore directly. This feeder owns the messages listener: it upserts each
// remote message (with reactions + receipt counts) into the local SQLite DB and
// pings `onChange` so the hook re-reads. Reuses the existing subscribeMessages
// mapping so reactions/counts/timestamps stay consistent with the legacy path.

import { subscribeMessages } from '../../lib/conversations';
import { upsertRemoteMessage } from '../repositories/messagesRepo';

function ms(ts: any): number | null {
  return ts?.toMillis?.() ?? null;
}

/** Start feeding one conversation's messages into the local DB. Returns unsubscribe. */
export function startConversationFeeder(conversationId: string, onChange: () => void): () => void {
  return subscribeMessages(conversationId, async (msgs) => {
    for (const m of msgs) {
      try {
        await upsertRemoteMessage({
          remoteId: m.id,
          conversationId,
          senderUid: m.senderUid ?? (m as any).senderId ?? '',
          senderDisplayName: m.senderDisplayName ?? null,
          text: m.text ?? null,
          remoteCreatedAt: ms(m.createdAt),
          editedAt: ms(m.editedAt),
          deletedForEveryone: !!m.deletedForEveryone,
          replyToMessageId: m.replyTo?.messageId ?? null,
          replyToPreview: m.replyTo?.preview ?? null,
          forwarded: !!m.forwarded,
          reactions: m.reactions ?? null,
          counts: {
            delivered: m.deliveredCount ?? 0,
            read: m.readCount ?? 0,
            viewed: m.viewedCount ?? 0,
            played: m.playedCount ?? 0,
          },
        });
      } catch { /* best-effort per message */ }
    }
    onChange();
  });
}
