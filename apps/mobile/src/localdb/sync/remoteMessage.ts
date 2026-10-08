// Pure mapping from a Firestore message document to the local upsert input.
// ONE mapper for every path that brings remote messages on-device (realtime
// feeder, incremental pull, history backfill, notification prefetch), so they
// can't drift apart — the history pages previously dropped type/caption/media,
// which turned older photos and voice notes into empty text rows.

import type { RemoteMessageInput } from '../repositories/messagesRepo';

function ms(ts: any): number | null {
  if (ts == null) return null;
  if (typeof ts === 'number') return ts;
  return ts?.toMillis?.() ?? null;
}

function messageType(t: unknown): RemoteMessageInput['type'] {
  return t === 'image' || t === 'voice' ? t : 'text';
}

export function remoteMessageInput(remoteId: string, conversationId: string, m: Record<string, any>): RemoteMessageInput {
  const media = m.media;
  return {
    remoteId,
    conversationId,
    senderUid: m.senderUid ?? m.senderId ?? '',
    senderDisplayName: m.senderDisplayName ?? null,
    type: messageType(m.type),
    caption: m.caption ?? null,
    text: m.text ?? null,
    remoteCreatedAt: ms(m.createdAt),
    editedAt: ms(m.editedAt),
    deletedForEveryone: !!m.deletedForEveryone,
    replyToMessageId: m.replyTo?.messageId ?? null,
    replyToPreview: m.replyTo?.preview ?? null,
    replyToSenderUid: m.replyTo?.senderUid ?? null,
    replyToSenderName: m.replyTo?.senderDisplayName ?? null,
    replyToType: m.replyTo?.type ?? null,
    mentions: Array.isArray(m.mentions) ? m.mentions : null,
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
    status: 'sent',
    clientLocalId: typeof m.clientLocalId === 'string' ? m.clientLocalId : null,
  };
}
