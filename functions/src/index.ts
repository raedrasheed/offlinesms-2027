// OfflineSMS Cloud Functions — entry barrel
import { initializeApp } from 'firebase-admin/app';
initializeApp();

export { onMessageCreate } from './chats/onMessageCreate';
export { getOrCreateDirectConversation } from './chats/getOrCreateDirectConversation';
export { sendTextMessage }                from './chats/sendTextMessage';
export { markRead }                       from './chats/markRead';
export { setTyping }                      from './chats/setTyping';

export { escalateSms } from './sms/escalate';
export { onSmsBatchAccepted } from './sms/onSmsBatchAccepted';
export { buyPoints } from './points/buy';
export { transferPoints } from './points/transfer';
export { onUserCreate } from './auth/onUserCreate';
export { setAdminClaim } from './auth/setAdminClaim';
export { claimUsername } from './auth/claimUsername';
