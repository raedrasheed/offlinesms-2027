// OfflineSMS Cloud Functions — entry barrel
import './options'; // must precede all function modules; sets global runtime caps
import { initializeApp } from 'firebase-admin/app';
initializeApp();

export { onMessageCreate } from './chats/onMessageCreate';
export { getOrCreateDirectConversation } from './chats/getOrCreateDirectConversation';
export { sendTextMessage }                from './chats/sendTextMessage';

// Phase 23 — media messages (images & voice notes).
export { createMediaMessage }   from './chats/createMediaMessage';
export { finalizeMediaMessage } from './chats/finalizeMediaMessage';
export { markRead }                       from './chats/markRead';
export { setTyping }                      from './chats/setTyping';

export { createGroup }   from './chats/createGroup';
export { addMembers }    from './chats/addMembers';
export { removeMember }  from './chats/removeMember';
export { changeRole }    from './chats/changeRole';
export { leaveGroup }    from './chats/leaveGroup';

// Phase 25 — external phone contacts.
export { createPhoneContact } from './contacts/createPhoneContact';
export { addExternalContactToGroup, removeExternalContactFromGroup } from './contacts/externalMembers';
export { linkPhoneContactsOnUserWrite } from './contacts/linkPhoneContacts';

// Phase 26 — group invite links.
export {
  createOrUpdateGroupInviteLink, resetGroupInviteLink, resolveGroupInviteLink,
  joinGroupByInviteLink, approveGroupJoinRequest, rejectGroupJoinRequest, cancelMyJoinRequest,
} from './chats/groupInvites';
export { lockGroup }     from './chats/lockGroup';

// Phase 6 — message actions.
export { editMessage }     from './chats/editMessage';
export { deleteMessage }   from './chats/deleteMessage';
export { reactToMessage }  from './chats/reactToMessage';
export { starMessage }     from './chats/starMessage';
export { pinMessage }      from './chats/pinMessage';
export { forwardMessages } from './chats/forwardMessages';
export { getMessageInfo }  from './chats/getMessageInfo';

// Phase 7 — receipts and status views.
export { markReceipt }       from './chats/markReceipt';
export { onReceiptWrite }    from './chats/onReceiptWrite';
export { markStatusViewed }  from './statuses/markStatusViewed';

// Disappearing-message sweeper is implemented at
// ./chats/sweepExpiredMessages but NOT exported here. Activation is
// deferred to Phase 11 alongside the client-side TTL setting UI.

export { escalateSms } from './sms/escalate';
export { previewSmsEscalation } from './sms/previewEscalation';
export { retryFailedSmsRecipients } from './sms/retryFailed';
export { onSmsBatchAccepted } from './sms/onSmsBatchAccepted';

// Phase 11 — OfflineSMS Delivery Report ingestion. HTTP function that
// validates HMAC + replay window before touching Firestore.
export { gatewayWebhook } from './sms/gatewayWebhook';

// Phase 16 — reap stuck SMS batches every 30 minutes.
// Idempotency is guarded inside the function by the pointsRefunded field.
// sweepExpiredMessages remains deferred until Phase 20 (no client TTL UI yet).
export { reapStuckBatches } from './sms/reapStuckBatches';

// Phase 10 — points purchase + transfer.
// The Phase 0 buyPoints callable (which credited the wallet directly)
// has been removed; createPurchase + confirmPayment / confirmPaymentMock
// replace it. The Phase 0 transferPoints (functions/src/points/transfer.ts)
// is superseded by functions/src/points/transferPoints.ts which adds the
// daily cap, frozen-wallet guard, canonical types, idempotency, and the
// fraud-flag emission.
export { createPurchase }      from './points/createPurchase';
export { confirmPayment }      from './points/confirmPayment';
export { confirmPaymentMock }  from './points/confirmPaymentMock';
export { transferPoints }      from './points/transferPoints';
export { onUserCreate } from './auth/onUserCreate';
export { setAdminClaim } from './auth/setAdminClaim';
export { claimUsername } from './auth/claimUsername';
export { matchContacts } from './contacts/matchContacts';

// Phase 13 — admin management callables.
export { setUserStatus } from './admin/setUserStatus';

// Phase 14 — admin-native group lock + role assignment.
export { adminLockGroup } from './admin/adminLockGroup';
export { adminSetRole }   from './admin/adminSetRole';

// Phase 15 — wallet freeze/unfreeze.
export { adminSetWalletStatus } from './admin/adminSetWalletStatus';

// Phase 18 — org-scoped role assignment.
export { adminSetOrgRole } from './admin/adminSetOrgRole';

// Phase 24 — OfflineSMS-Business relay (private, business-only SMS gateway).
// Additive only: the HTTP provider path (escalateSms/gateway) is unchanged and
// relay is gated by smsConfig/providers (default 'http').
export { createRelayPairingCode, enrollRelayDevice, relayHeartbeat, revokeRelayDevice } from './sms/relayDevices';
export { claimRelayJobs, reportRelayDelivery } from './sms/relayJobs';
// Relay-only reaper (Phase 3): lease expiry/requeue + stale-device offline +
// metrics. Touches relay* collections only; no production SMS impact.
export { relayReaper } from './sms/relayReaper';

// Phase 24 — OTP over relay (custom-token phone sign-in; no Firebase phone auth).
export { requestPhoneOtp } from './auth/requestPhoneOtp';
export { verifyPhoneOtp } from './auth/verifyPhoneOtp';
