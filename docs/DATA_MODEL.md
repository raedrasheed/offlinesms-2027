# Data model

## Collections

### `users/{uid}`
```ts
{
  displayName?: string;
  username?: string;
  phoneNumber?: string;
  email?: string;
  avatarUrl?: string;
  about?: string;
  status: 'active' | 'blocked';
  createdAt: Timestamp;
  lastSeen?: Timestamp;
  fcmTokens?: string[];
}
```

### `conversations/{convoId}`
```ts
{
  type: 'dm' | 'group' | 'channel';
  name?: string;             // groups / channels
  photoUrl?: string;
  memberIds: string[];       // denormalized for chats-list query
  ownerId?: string;
  lastMessageText?: string;
  lastMessageAt?: Timestamp;
  lastSenderId?: string;
  disappearingDuration?: number; // ms
  locked?: boolean;
  createdAt: Timestamp;
}
```

Sub-collections:
- `conversations/{c}/members/{uid}` — `{ role: 'owner' | 'admin' | 'member', joinedAt }`
- `conversations/{c}/messages/{msgId}` — see below
- `conversations/{c}/messages/{m}/receipts/{uid}` — `{ status, deliveredAt, readAt, playedAt }`

### `conversations/{c}/messages/{msgId}`
```ts
{
  senderId: string;
  type: 'text' | 'image' | 'audio' | 'file' | 'location' | 'poll' | 'system';
  text?: string;
  mediaUrl?: string;
  metadata?: Record<string, unknown>;
  forwarded?: boolean;
  replyTo?: string;
  createdAt: Timestamp;
  editedAt?: Timestamp;
}
```

### `wallets/{uid}`
```ts
{
  balance: number;     // OfflineSMS Points
  reserved: number;    // reserved for in-flight SMS batches
  updatedAt?: Timestamp;
}
```

### `transactions/{txId}`
```ts
{
  userId: string;
  type: 'buy' | 'sms' | 'transfer-in' | 'transfer-out' | 'refund' | 'admin-adjust';
  amount: number;      // signed
  package?: string;    // for buy
  batchId?: string;    // for sms
  peerId?: string;     // for transfers
  note?: string;
  createdAt: Timestamp;
}
```

### `smsBatches/{batchId}`
```ts
{
  messageId: string;
  conversationId: string;
  senderId: string;
  audience: 'unread' | 'undelivered' | 'everyone';
  smsBody: string;
  recipientCount: number;
  estimatedCost: number;
  gatewayBatchId?: string;
  status: 'sending' | 'accepted' | 'partial' | 'completed' | 'failed';
  createdAt: Timestamp;
}
```
Sub-collection `smsBatches/{b}/recipients/{uid}` — `{ maskedPhone, smsStatus, reason, providerMessageId, sentAt, deliveredAt, failedAt }`

### `statuses/{statusId}`
```ts
{
  authorId: string;
  type: 'text' | 'image' | 'video';
  body?: string;
  mediaUrl?: string;
  backgroundColor?: string;
  audience: 'contacts' | 'except' | 'only';
  audienceList?: string[];
  expiresAt: Timestamp;   // +24h
  createdAt: Timestamp;
}
```

### `settings/{doc}`
Singletons for system-wide config — `sms-gateway`, `points-cost-rules`,
`packages`, `feature-flags`, `branding`.
