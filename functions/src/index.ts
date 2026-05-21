// OfflineSMS Cloud Functions — entry barrel
import { initializeApp } from 'firebase-admin/app';
initializeApp();

export { onMessageCreate } from './chats/onMessageCreate';
export { getOrCreateDirectConversation } from './chats/getOrCreateDirectConversation';
export { sendTextMessage }                from './chats/sendTextMessage';
export { markRead }                       from './chats/markRead';
export { setTyping }                      from './chats/setTyping';

export { createGroup }   from './chats/createGroup';
export { addMembers }    from './chats/addMembers';
export { removeMember }  from './chats/removeMember';
export { changeRole }    from './chats/changeRole';
export { leaveGroup }    from './chats/leaveGroup';
export { lockGroup }     from './chats/lockGroup';

// Phase 6 — message actions.
export { editMessage }     from './chats/editMessage';
export { deleteMessage }   from './chats/deleteMessage';
export { reactToMessage }  from './chats/reactToMessage';
export { starMessage }     from './chats/starMessage';
export { pinMessage }      from './chats/pinMessage';
export { forwardMessages } from './chats/forwardMessages';
export { getMessageInfo }  from './chats/getMessageInfo';

// Disappearing-message sweeper is implemented at
// ./chats/sweepExpiredMessages but NOT exported here. Activation is
// deferred to Phase 11 alongside the client-side TTL setting UI.

export { escalateSms } from './sms/escalate';
export { onSmsBatchAccepted } from './sms/onSmsBatchAccepted';
export { buyPoints } from './points/buy';
export { transferPoints } from './points/transfer';
export { onUserCreate } from './auth/onUserCreate';
export { setAdminClaim } from './auth/setAdminClaim';
export { claimUsername } from './auth/claimUsername';
