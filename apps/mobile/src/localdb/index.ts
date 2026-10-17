// Phase 22 — local-first data layer public API.
//
// Lifecycle (call from auth state handling once the cutover is enabled):
//   await initLocalDb(uid)   // open DB + start sync scheduler
//   await teardownLocalDb()  // stop sync + close (keeps data)
//   await wipeAndClose()     // logout: stop sync + wipe user data + close
//
// Read paths: import repositories directly (conversationsRepo, messagesRepo…).
// Write path for an optimistic outgoing message: queueSendMessage(...).

import { attachmentFallback, type LocationAttachment, type ContactAttachment } from '../media/attachmentModel';
import { openForUser, closeDb, wipeUserData, getCurrentUid } from './connection';
import { startScheduler, stopScheduler, kick } from './sync/syncScheduler';
import * as messagesRepo from './repositories/messagesRepo';
import * as outboxRepo from './repositories/outboxRepo';
import * as externalMembersRepo from './repositories/externalMembersRepo';
import { getDeviceId, getCursor, setCursor, getState, setState } from './repositories/syncStateRepo';
import { idempotencyKey, localId } from './sync/ids';
import { sanitizePoll, parsePoll, applyLocalVote } from '../lib/pollModel';
import { toggleReaction } from './sync/reactionLogic';
import { phoneDigits } from '../lib/phone';
import { isOnline, onConnectivityChange } from './sync/networkState';
import { pullMessageById } from './sync/firebasePull';
import { auth } from '../lib/firebase';
import { createNotificationTargets } from './sync/notificationTarget';
import type { MessageRow } from './types';
import { enqueuePollClose } from './pollClose';
import { retryQueuedSend } from './retrySend';
import { emitLocalMessagesChanged, onLocalMessagesChanged } from './messageChanges';

export * from './types';
export { getDb, getCurrentUid } from './connection';
export * as conversationsRepo from './repositories/conversationsRepo';
export * as messagesRepo from './repositories/messagesRepo';
export * as outboxRepo from './repositories/outboxRepo';
export * as externalMembersRepo from './repositories/externalMembersRepo';
export * as receiptsRepo from './repositories/receiptsRepo';
export * as membersRepo from './repositories/membersRepo';
export * as syncStateRepo from './repositories/syncStateRepo';
export { syncNow, pushOutbox, pullRemoteChanges, retryFailedOutboxItem, isSyncing, pullConversationNow } from './sync/syncEngine';
export type { TargetState } from './sync/notificationTarget';

/**
 * The message a notification points at — fetched directly (one document read),
 * independently of the boot sync / history backfill / realtime listener, and
 * queued until the local DB opens on a cold start or the network returns.
 */
export const notificationTargets = createNotificationTargets({
  isDbOpen: () => getCurrentUid() != null && auth.currentUser?.uid === getCurrentUid(),
  isOnline,
  hasLocal: async messageId => {
    const row = await messagesRepo.getByRemoteId(messageId);
    if (!row) return false;
    return row.deleted_for_everyone === 1 || !['image', 'voice', 'file', 'audio', 'video'].includes(row.type)
      || row.media_upload_status === 'uploaded' && !!row.media_download_url;
  },
  fetchOne: (conversationId, messageId) => pullMessageById(conversationId, messageId),
  onConnectivity: onConnectivityChange,
  loadPending: async () => JSON.parse((await getState('notification_targets')) ?? '[]'),
  savePending: targets => setState('notification_targets', JSON.stringify(targets)),
});
onLocalMessagesChanged(conversationId => {
  void notificationTargets.onLocalMessagesChanged(conversationId);
});
export { setActiveConversation, kick as kickSync } from './sync/syncScheduler';

let started = false;
function prepareUser(uid: string): void {
  if (getCurrentUid() && getCurrentUid() !== uid) {
    notificationTargets.reset();
    if (started) { stopScheduler(); started = false; }
  }
}

/** Open the per-user DB only (no message-sync scheduler). Used by Phase 22B
 *  where the chat-list feeder drives writes. */
export async function openLocalDb(uid: string): Promise<void> {
  prepareUser(uid);
  await openForUser(uid);
  notificationTargets.onDbOpened();
}

export async function initLocalDb(uid: string): Promise<void> {
  prepareUser(uid);
  await openForUser(uid);
  // Clear any inherited backlog of read-receipts that are stuck failing (e.g. a
  // bulk enqueue hard-failing with `internal`). Best-effort, so dropping them is
  // safe and keeps the outbox from churning + starving real mutations.
  try { const n = await outboxRepo.dropStuckReceipts(); if (n) console.log(`[outbox] cleared ${n} stuck receipt(s)`); } catch { /* best-effort */ }
  if (!started) { startScheduler(); started = true; }
  notificationTargets.onDbOpened();
}

export async function teardownLocalDb(): Promise<void> {
  notificationTargets.reset();
  if (started) { stopScheduler(); started = false; }
  await closeDb();
}

export async function wipeAndClose(): Promise<void> {
  notificationTargets.reset();
  if (started) { stopScheduler(); started = false; }
  await wipeUserData();
  await closeDb();
}

export interface QueueSendInput {
  conversationId: string;
  senderUid: string;
  senderDisplayName?: string | null;
  text: string;
  replyTo?: { messageId: string; senderUid?: string; senderDisplayName?: string; preview?: string; type?: string } | null;
  mentions?: Array<{ userId: string; displayName: string; startIndex: number; endIndex: number }> | null;
  /** Sticker / poll messages ride the same send path (server: sendTextMessage kind). */
  kind?: 'text' | 'sticker' | 'poll' | 'location' | 'contact';
  location?: LocationAttachment;
  contact?: ContactAttachment;
  sticker?: { packId: string; stickerId: string; alt: string } | null;
  poll?: { question: string; options: string[]; multiple: boolean } | null;
}

function kindPayload(input: QueueSendInput): { text: string; payloadJson: string | null } {
  if (input.kind === 'location' && input.location) return { text: attachmentFallback({kind:'location',location:input.location}), payloadJson: JSON.stringify(input.location) };
  if (input.kind === 'contact' && input.contact) return { text: attachmentFallback({kind:'contact',contact:input.contact}), payloadJson: JSON.stringify(input.contact) };
  if (input.kind === 'sticker' && input.sticker) {
    return { text: input.sticker.alt, payloadJson: JSON.stringify(input.sticker) };
  }
  if (input.kind === 'poll' && input.poll) {
    const options = input.poll.options.map(o => o.replace(/\s+/g, ' ').trim()).filter(Boolean)
      .map((text, i) => ({ id: `o${i + 1}`, text }));
    const question = input.poll.question.replace(/\s+/g, ' ').trim();
    return {
      text: `📊 ${question}`,
      payloadJson: JSON.stringify(sanitizePoll({ question, options, multiple: input.poll.multiple, closed: false, votes: {} })),
    };
  }
  return { text: input.text, payloadJson: null };
}

/**
 * Write an optimistic outgoing message to the local DB (status `pending`) and
 * enqueue a matching idempotent outbox item. Returns the local message row so
 * the UI can render it immediately. The sync engine delivers it when online.
 */
export async function queueSendMessage(input: QueueSendInput): Promise<MessageRow> {
  if (!getCurrentUid()) throw new Error('localdb: not initialised');
  const deviceId = await getDeviceId();
  const clientSequence = await messagesRepo.nextClientSequence(input.conversationId);

  const kind = input.kind ?? 'text';
  const { text, payloadJson } = kindPayload(input);
  const mentions = kind === 'text' && input.mentions && input.mentions.length > 0 ? input.mentions : null;
  const row = await messagesRepo.insertLocalMessage({
    conversationId: input.conversationId,
    senderUid: input.senderUid,
    senderDisplayName: input.senderDisplayName ?? null,
    text,
    type: kind,
    payloadJson,
    replyToMessageId: input.replyTo?.messageId ?? null,
    replyToPreview: input.replyTo?.preview ?? null,
    replyToSenderUid: input.replyTo?.senderUid ?? null,
    replyToSenderName: input.replyTo?.senderDisplayName ?? null,
    replyToType: input.replyTo?.type ?? (input.replyTo ? 'text' : null),
    mentionsJson: mentions ? JSON.stringify(mentions) : null,
    deviceId,
    clientSequence,
  });

  await outboxRepo.enqueue({
    type: 'send_message',
    entityType: 'message',
    entityId: row.local_id,
    conversationId: input.conversationId,
    idempotencyKey: idempotencyKey(['send', deviceId, row.local_id]),
    payload: {
      conversationId: input.conversationId,
      text,
      replyTo: kind === 'poll' ? null : (input.replyTo ?? null),
      mentions,
      localId: row.local_id,
      clientCreatedAt: row.created_at,
      ...(kind !== 'text' ? { kind } : {}),
      ...(kind === 'sticker' && input.sticker ? { sticker: { packId: input.sticker.packId, stickerId: input.sticker.stickerId } } : {}),
      ...(kind === 'poll' && input.poll ? { poll: input.poll } : {}),
      ...(kind === 'location' ? {location: input.location} : {}),
      ...(kind === 'contact' ? {contact: input.contact} : {}),
    },
  });

  kick('outbox');
  return row;
}

let lastVoteSeq = 0;

/**
 * Vote in a poll: optimistic local tally + an outbox item. Each vote carries a
 * strictly increasing `seq`, so the server ignores a late retry of an older
 * vote; retries of the same vote are no-ops server-side (no double counting).
 */
export async function queueVotePoll(args: { conversationId: string; messageId: string; uid: string; optionIds: string[] }): Promise<ActionResult> {
  if (!getCurrentUid()) return { ok: false, reason: 'not-initialised' };
  const msg = await messagesRepo.getByRemoteId(args.messageId);
  if (!msg) return { ok: false, reason: 'not-delivered' };
  const poll = parsePoll(msg.payload_json);
  if (!poll || poll.closed) return { ok: false, reason: 'not-a-poll' };
  await messagesRepo.setPayload(args.messageId, JSON.stringify(applyLocalVote(poll, args.uid, args.optionIds)));
  const seq = lastVoteSeq = Math.max(Date.now(), lastVoteSeq + 1);
  const deviceId = await getDeviceId();
  await outboxRepo.enqueue({
    type: 'vote_poll', entityType: 'message', entityId: args.messageId,
    conversationId: args.conversationId,
    idempotencyKey: idempotencyKey(['vote', deviceId, args.messageId, String(seq)]),
    payload: { conversationId: args.conversationId, messageId: args.messageId, optionIds: args.optionIds, seq },
  });
  emitLocalMessagesChanged(args.conversationId);
  kick('outbox');
  return { ok: true };
}

/** Queue closing even offline, and deliver it after reconnect. */
export async function queueClosePoll(args: { conversationId: string; messageId: string }) {
  const result = await enqueuePollClose(args);
  if (result.ok) kick('outbox');
  return result;
}

export async function retryQueuedMessage(localId: string): Promise<void> {
  if (await retryQueuedSend(localId)) kick('outbox');
}

export interface QueueSendImageInput {
  conversationId: string;
  senderUid: string;
  senderDisplayName?: string | null;
  localUri: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  caption?: string | null;
  replyTo?: { messageId: string; senderUid?: string; senderDisplayName?: string; preview?: string } | null;
}

/**
 * Phase 23 — write an optimistic local image message (status `pending`,
 * uploadStatus `pending`) and enqueue a `send_image_message` outbox item. The
 * sync engine runs create → upload → finalize when online and reconciles the
 * local row to the server message id. The local file is the render source until
 * the download URL arrives, so the bubble shows immediately (and offline).
 */
export async function queueSendImageMessage(input: QueueSendImageInput): Promise<MessageRow> {
  if (!getCurrentUid()) throw new Error('localdb: not initialised');
  const deviceId = await getDeviceId();
  const clientSequence = await messagesRepo.nextClientSequence(input.conversationId);

  const row = await messagesRepo.insertLocalMediaMessage({
    conversationId: input.conversationId,
    senderUid: input.senderUid,
    senderDisplayName: input.senderDisplayName ?? null,
    mediaType: 'image',
    caption: input.caption ?? null,
    localUri: input.localUri,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    width: input.width ?? null,
    height: input.height ?? null,
    replyToMessageId: input.replyTo?.messageId ?? null,
    replyToPreview: input.replyTo?.preview ?? null,
    deviceId,
    clientSequence,
  });

  await outboxRepo.enqueue({
    type: 'send_image_message',
    entityType: 'message',
    entityId: row.local_id,
    conversationId: input.conversationId,
    idempotencyKey: idempotencyKey(['send-image', deviceId, row.local_id]),
    payload: {
      conversationId: input.conversationId,
      localMessageId: row.local_id,
      localUri: input.localUri,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      width: input.width ?? null,
      height: input.height ?? null,
      caption: input.caption ?? null,
      replyTo: input.replyTo ?? null,
    },
  });

  kick('outbox');
  return row;
}

export interface QueueSendVoiceInput {
  conversationId: string;
  senderUid: string;
  senderDisplayName?: string | null;
  localUri: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  waveform?: number[] | null;
  replyTo?: { messageId: string; senderUid?: string; senderDisplayName?: string; preview?: string } | null;
}

/** Phase 23 — optimistic local voice message + `send_voice_message` outbox item. */
export async function queueSendVoiceMessage(input: QueueSendVoiceInput): Promise<MessageRow> {
  if (!getCurrentUid()) throw new Error('localdb: not initialised');
  const deviceId = await getDeviceId();
  const clientSequence = await messagesRepo.nextClientSequence(input.conversationId);

  const row = await messagesRepo.insertLocalMediaMessage({
    conversationId: input.conversationId,
    senderUid: input.senderUid,
    senderDisplayName: input.senderDisplayName ?? null,
    mediaType: 'voice',
    localUri: input.localUri,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    durationMs: input.durationMs,
    waveform: input.waveform ?? null,
    replyToMessageId: input.replyTo?.messageId ?? null,
    replyToPreview: input.replyTo?.preview ?? null,
    deviceId,
    clientSequence,
  });

  await outboxRepo.enqueue({
    type: 'send_voice_message',
    entityType: 'message',
    entityId: row.local_id,
    conversationId: input.conversationId,
    idempotencyKey: idempotencyKey(['send-voice', deviceId, row.local_id]),
    payload: {
      conversationId: input.conversationId,
      localMessageId: row.local_id,
      localUri: input.localUri,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      durationMs: input.durationMs,
      waveform: input.waveform ?? null,
      replyTo: input.replyTo ?? null,
    },
  });

  kick('outbox');
  return row;
}

/** Persist the selected file before queueing; picker cache can be evicted on restart. */
export async function queueSendAttachment(input: QueueSendImageInput & {
  mediaType: 'file' | 'video' | 'audio' | 'image'; fileName: string; durationMs?: number | null; presentation?: 'sticker';
}): Promise<MessageRow> {
  if (!getCurrentUid() || getCurrentUid() !== input.senderUid) throw new Error('localdb: not initialised');
  const FileSystem = await import('expo-file-system');
  const { attachmentLimit, attachmentMimeAllowed, MIME_EXTENSIONS, cleanFileName, normalizeAttachmentMime, validCustomStickerMetadata } = await import('../media/attachmentModel');
  const mimeType = normalizeAttachmentMime(input.mimeType);
  const stat = await FileSystem.getInfoAsync(input.localUri);
  const size = stat.exists && !stat.isDirectory ? stat.size : 0;
  if (!size || size > attachmentLimit(input.mediaType) || !attachmentMimeAllowed(input.mediaType, mimeType)) throw new Error('attachment-invalid');
  if (input.presentation && (input.mediaType !== 'image' || !validCustomStickerMetadata({...input, mimeType, sizeBytes:size}))) throw new Error('sticker-invalid');
  const dir = `${FileSystem.documentDirectory}OfflineSMS/Outgoing/${input.senderUid}/`;
  await FileSystem.makeDirectoryAsync(dir, {intermediates:true});
  const uri = `${dir}${localId('attachment')}.${MIME_EXTENSIONS[mimeType]}`;
  await FileSystem.copyAsync({from:input.localUri,to:uri});
  const fileName = cleanFileName(input.fileName);
  const deviceId = await getDeviceId();
  const row = await messagesRepo.insertLocalMediaMessage({
    ...input, mimeType, fileName, localUri:uri, sizeBytes:size, deviceId,
    clientSequence:await messagesRepo.nextClientSequence(input.conversationId),
    replyToMessageId:input.replyTo?.messageId, replyToPreview:input.replyTo?.preview,
  });
  await outboxRepo.enqueue({type:'send_attachment_message',entityType:'message',entityId:row.local_id,
    conversationId:input.conversationId,idempotencyKey:idempotencyKey(['attachment',deviceId,row.local_id]),
    payload:{...input,mimeType,localUri:uri,sizeBytes:size,fileName,localMessageId:row.local_id},
  });
  emitLocalMessagesChanged(input.conversationId);
  kick('outbox');
  return row;
}

/** Phase 23 — retry a failed media upload: reset its outbox item + local state. */
export async function retryMediaMessage(localMessageId: string): Promise<void> {
  if (!getCurrentUid()) return;
  const row = await messagesRepo.getByRemoteId(localMessageId) ?? await messagesRepo.getByLocalId(localMessageId);
  const id = row?.local_id ?? localMessageId;
  await messagesRepo.setMediaProgress(id, 0);
  await outboxRepo.retryByEntityId(id);
  if (row) emitLocalMessagesChanged(row.conversation_id);
  kick('outbox');
}

/**
 * Phase 23 — clear a chat's history on this device. Deletes the local messages
 * and records a "cleared" watermark so the realtime feeder / catch-up pull don't
 * resurrect older messages; messages sent after this point still appear.
 */
export async function clearChat(conversationId: string): Promise<number> {
  if (!getCurrentUid()) return 0;
  // Watermark on the SAME clock as the messages (server time), not Date.now() —
  // otherwise device/server clock skew can hide genuinely new incoming messages.
  const watermark = await messagesRepo.getMaxMessageTime(conversationId);
  await setCursor(`chat_cleared:${conversationId}`, watermark);
  // Keep the pull cursor at the watermark so it resumes correctly.
  await setCursor(`msg_cursor:${conversationId}`, watermark);
  await messagesRepo.deleteConversationMessages(conversationId);
  return watermark;
}

export async function getChatClearedAt(conversationId: string): Promise<number> {
  return getCursor(`chat_cleared:${conversationId}`);
}

export interface ActionResult { ok: boolean; reason?: 'not-initialised' | 'not-delivered' | 'not-a-poll' }

function parseReactions(json: string | null): Record<string, string[]> | null {
  if (!json) return null;
  try { const p = JSON.parse(json); return p && typeof p === 'object' ? p : null; } catch { return null; }
}

/**
 * Phase 22D — react to a message: optimistic local toggle + idempotent outbox
 * item. Requires the message's remote id (a still-pending message must be
 * delivered first). Toggles are order-sensitive, so each tap is its own item.
 */
export async function queueReactMessage(args: { conversationId: string; messageId: string; emoji: string; uid: string }): Promise<ActionResult> {
  if (!getCurrentUid()) return { ok: false, reason: 'not-initialised' };
  const msg = await messagesRepo.getByRemoteId(args.messageId);
  if (!msg) return { ok: false, reason: 'not-delivered' };
  const next = toggleReaction(parseReactions(msg.reactions_json), args.emoji, args.uid);
  await messagesRepo.updateReactions(args.messageId, next);
  // Idempotency key is stable per (message, user, emoji) — double-taps before
  // the worker drains MUST collapse to a single outbox row, not enqueue two.
  // The outbox UNIQUE constraint then naturally dedupes the rapid retap.
  await outboxRepo.enqueue({
    type: 'react_message', entityType: 'message', entityId: args.messageId,
    conversationId: args.conversationId,
    idempotencyKey: idempotencyKey(['react', args.messageId, args.uid, args.emoji]),
    payload: { conversationId: args.conversationId, messageId: args.messageId, emoji: args.emoji },
  });
  kick('outbox');
  return { ok: true };
}

/** Phase 22D — edit a message: optimistic local text update + outbox item. */
export async function queueEditMessage(args: { conversationId: string; messageId: string; text: string }): Promise<ActionResult> {
  if (!getCurrentUid()) return { ok: false, reason: 'not-initialised' };
  const msg = await messagesRepo.getByRemoteId(args.messageId);
  if (!msg) return { ok: false, reason: 'not-delivered' };
  await messagesRepo.updateText(args.messageId, args.text);
  await outboxRepo.enqueue({
    type: 'edit_message', entityType: 'message', entityId: args.messageId,
    conversationId: args.conversationId,
    idempotencyKey: idempotencyKey(['edit', args.messageId, localId('edit')]),
    payload: { conversationId: args.conversationId, messageId: args.messageId, text: args.text },
  });
  kick('outbox');
  return { ok: true };
}

/** Phase 22D — delete a message: optimistic local delete + idempotent outbox item. */
export async function queueDeleteMessage(args: { conversationId: string; messageId: string; mode: 'for_me' | 'for_everyone' }): Promise<ActionResult> {
  if (!getCurrentUid()) return { ok: false, reason: 'not-initialised' };
  const msg = await messagesRepo.getByRemoteId(args.messageId);
  if (!msg) return { ok: false, reason: 'not-delivered' };
  if (args.mode === 'for_everyone') await messagesRepo.markDeletedForEveryone(args.messageId);
  else await messagesRepo.markDeletedForMe(args.messageId);
  await outboxRepo.enqueue({
    type: 'delete_message', entityType: 'message', entityId: args.messageId,
    conversationId: args.conversationId,
    idempotencyKey: idempotencyKey(['delete', args.messageId, args.mode]),
    payload: { conversationId: args.conversationId, messageId: args.messageId, mode: args.mode },
  });
  kick('outbox');
  return { ok: true };
}

/**
 * Phase 22D — star/pin/receipt through the outbox. Read-state for these still
 * comes from the live userState/conversation subscriptions, so there's no local
 * mutation here — just the idempotent enqueue. Idempotency keys collapse repeat
 * writes to the same target state (and naturally batch receipts).
 */
export async function queueStarMessage(args: { conversationId: string; messageId: string; starred: boolean }): Promise<ActionResult> {
  if (!getCurrentUid()) return { ok: false, reason: 'not-initialised' };
  await outboxRepo.enqueue({
    type: 'star_message', entityType: 'message', entityId: args.messageId,
    conversationId: args.conversationId,
    idempotencyKey: idempotencyKey(['star', args.messageId, String(args.starred), localId('star')]),
    payload: { conversationId: args.conversationId, messageId: args.messageId, starred: args.starred },
  });
  kick('outbox');
  return { ok: true };
}

export async function queuePinMessage(args: { conversationId: string; messageId: string; pinned: boolean }): Promise<ActionResult> {
  if (!getCurrentUid()) return { ok: false, reason: 'not-initialised' };
  await outboxRepo.enqueue({
    type: 'pin_message', entityType: 'message', entityId: args.messageId,
    conversationId: args.conversationId,
    idempotencyKey: idempotencyKey(['pin', args.messageId, String(args.pinned), localId('pin')]),
    payload: { conversationId: args.conversationId, messageId: args.messageId, pinned: args.pinned },
  });
  kick('outbox');
  return { ok: true };
}

export async function queueMarkReceipt(args: { conversationId: string; messageId: string; status: string }): Promise<ActionResult> {
  if (!getCurrentUid()) return { ok: false, reason: 'not-initialised' };
  await outboxRepo.enqueue({
    type: 'mark_receipt', entityType: 'message', entityId: args.messageId,
    conversationId: args.conversationId,
    // Idempotent per (message, status) → repeated receipts collapse to one item.
    idempotencyKey: idempotencyKey(['receipt', args.messageId, args.status]),
    payload: { conversationId: args.conversationId, messageId: args.messageId, status: args.status },
    // Receipts are best-effort: cap retries so a chronically-failing backlog
    // dead-letters quickly instead of churning the queue (and battery) 8× each.
    maxAttempts: 3,
  });
  kick('outbox');
  return { ok: true };
}

// ── External phone contacts (Phase 25) ──────────────────────────────────────
// Optimistic local write to external_members + durable outbox item, so adds
// survive offline / app restart and sync on reconnect. Idempotency keys are
// stable per (conversation, phone) so a retry never double-adds.

export async function queueAddExternalContactToGroup(args: {
  conversationId: string; displayName: string; phoneE164: string; defaultCountry?: string;
}): Promise<ActionResult> {
  if (!getCurrentUid()) return { ok: false, reason: 'not-initialised' };
  const digits = phoneDigits(args.phoneE164);
  // Optimistic row (pending) — appears immediately in GroupInfo, even offline.
  await externalMembersRepo.upsertExternalMember({
    conversationId:  args.conversationId,
    contactId:       digits,                 // matches the server's externalMember id
    displayName:     args.displayName,
    phoneE164:       args.phoneE164,
    normalizedPhone: digits,
    isRegistered:    false,
    pending:         true,
  });
  await outboxRepo.enqueue({
    type: 'add_external_contact_to_group', entityType: 'externalMember', entityId: digits,
    conversationId: args.conversationId,
    idempotencyKey: idempotencyKey(['addExternal', args.conversationId, digits]),
    payload: {
      conversationId: args.conversationId,
      displayName: args.displayName,
      phoneNumber: args.phoneE164,
      defaultCountry: args.defaultCountry,
    },
  });
  kick('outbox');
  return { ok: true };
}

export async function queueRemoveExternalContactFromGroup(args: {
  conversationId: string; contactId: string;
}): Promise<ActionResult> {
  if (!getCurrentUid()) return { ok: false, reason: 'not-initialised' };
  await externalMembersRepo.removeExternalMember(args.conversationId, args.contactId);
  await outboxRepo.enqueue({
    type: 'remove_external_contact_from_group', entityType: 'externalMember', entityId: args.contactId,
    conversationId: args.conversationId,
    idempotencyKey: idempotencyKey(['removeExternal', args.conversationId, args.contactId]),
    payload: { conversationId: args.conversationId, contactId: args.contactId },
  });
  kick('outbox');
  return { ok: true };
}
