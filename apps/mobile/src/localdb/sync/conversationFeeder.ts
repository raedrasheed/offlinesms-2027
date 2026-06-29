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
        const media = (m as any).media;
        await upsertRemoteMessage({
          remoteId: m.id,
          conversationId,
          senderUid: m.senderUid ?? (m as any).senderId ?? '',
          senderDisplayName: m.senderDisplayName ?? null,
          type: (m as any).type ?? 'text',
          caption: (m as any).caption ?? null,
          text: m.text ?? null,
          remoteCreatedAt: ms(m.createdAt),
          editedAt: ms(m.editedAt),
          deletedForEveryone: !!m.deletedForEveryone,
          replyToMessageId: m.replyTo?.messageId ?? null,
          replyToPreview: m.replyTo?.preview ?? null,
          replyToSenderUid: m.replyTo?.senderUid ?? null,
          replyToSenderName: m.replyTo?.senderDisplayName ?? null,
          replyToType: (m.replyTo as any)?.type ?? null,
          mentions: Array.isArray((m as any).mentions) ? (m as any).mentions : null,
          forwarded: !!m.forwarded,
          reactions: m.reactions ?? null,
          counts: {
            delivered: m.deliveredCount ?? 0,
            read: m.readCount ?? 0,
            viewed: m.viewedCount ?? 0,
            played: m.playedCount ?? 0,
          },
          media: media ? {
            mimeType: media.mimeType ?? null,
            sizeBytes: media.sizeBytes ?? null,
            width: media.width ?? null,
            height: media.height ?? null,
            durationMs: media.durationMs ?? null,
            waveform: media.waveform ?? null,
            storagePath: media.storagePath ?? null,
            downloadURL: media.downloadURL ?? null,
            thumbnailPath: media.thumbnailPath ?? null,
            thumbnailURL: media.thumbnailURL ?? null,
            uploadStatus: media.uploadStatus ?? null,
          } : null,
        });
      } catch { /* best-effort per message */ }
    }
    onChange();
  });
}
