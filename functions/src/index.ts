// OfflineSMS Cloud Functions — entry barrel
import { initializeApp } from 'firebase-admin/app';
initializeApp();

export { onMessageCreate } from './chats/onMessageCreate';
export { escalateSms } from './sms/escalate';
export { onSmsBatchAccepted } from './sms/onSmsBatchAccepted';
export { buyPoints } from './points/buy';
export { transferPoints } from './points/transfer';
export { onUserCreate } from './auth/onUserCreate';
export { setAdminClaim } from './auth/setAdminClaim';
export { claimUsername } from './auth/claimUsername';
