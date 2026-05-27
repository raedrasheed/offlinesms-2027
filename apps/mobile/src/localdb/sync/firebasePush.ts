// Phase 22 — push: map outbox items to existing Cloud Function callables.
//
// IMPORTANT: privileged/business operations always go through their callable
// (never a raw Firestore write), so server-side permission, audit, points, and
// SMS logic stay authoritative. send_message passes localId + idempotencyKey so
// the server can dedupe retries (see functions/src/chats/sendTextMessage.ts).

import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../lib/firebase';
import type { OutboxRow } from '../types';

export interface PushResult {
  ok: boolean;
  remoteId?: string;       // canonical message id for reconciliation
  idempotent?: boolean;    // server recognised a duplicate
}

function call<T = any>(name: string, data: any): Promise<T> {
  return httpsCallable<any, T>(getFunctions(app), name)(data).then(r => r.data);
}

export async function pushOutboxItem(item: OutboxRow): Promise<PushResult> {
  const payload = JSON.parse(item.payload_json || '{}');

  switch (item.type) {
    case 'send_message': {
      const res = await call<{ messageId: string; idempotent?: boolean }>('sendTextMessage', {
        conversationId: payload.conversationId,
        text: payload.text,
        replyTo: payload.replyTo ?? null,
        localId: payload.localId,
        idempotencyKey: item.idempotency_key,
        clientCreatedAt: payload.clientCreatedAt ?? null,
      });
      return { ok: true, remoteId: res?.messageId, idempotent: res?.idempotent };
    }
    case 'edit_message':
      await call('editMessage', { conversationId: payload.conversationId, messageId: payload.messageId, text: payload.text });
      return { ok: true };
    case 'delete_message':
      await call('deleteMessage', { conversationId: payload.conversationId, messageId: payload.messageId, mode: payload.mode });
      return { ok: true };
    case 'react_message':
      await call('reactToMessage', { conversationId: payload.conversationId, messageId: payload.messageId, emoji: payload.emoji });
      return { ok: true };
    case 'star_message':
      await call('starMessage', { conversationId: payload.conversationId, messageId: payload.messageId, starred: payload.starred });
      return { ok: true };
    case 'pin_message':
      await call('pinMessage', { conversationId: payload.conversationId, messageId: payload.messageId, pinned: payload.pinned });
      return { ok: true };
    case 'mark_receipt':
      await call('markReceipt', payload);
      return { ok: true };
    case 'create_group':
      await call('createGroup', payload);
      return { ok: true };
    case 'group_action':
      await call(payload.action, payload.args ?? {});
      return { ok: true };
    case 'sms_escalation':
      await call('escalateSms', payload);
      return { ok: true };
    case 'support_ticket':
      await call('createSupportTicket', payload);
      return { ok: true };
    default:
      throw Object.assign(new Error(`unknown outbox type: ${item.type}`), { code: 'functions/invalid-argument' });
  }
}
