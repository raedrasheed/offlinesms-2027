# OfflineSMS Phase 5 Plan

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Prereqs:** Phase 4 complete (`dbd17ef`).

---

## Objective

Add **group conversations and member management** on top of Phase 4's direct-chat foundation. Reuse the same `conversations/{id}` shape, the same `messages` / `userState` / `typing` sub-collections, and the same `onMessageCreate` trigger — only the entry-points change.

No media, no message actions, no SMS, no points, no communities, no calls, no dashboard moderation.

---

## Exact scope

### Data model

`conversations/{id}` is extended (the Phase 4 fields stay):

```ts
{
  // existing Phase 4
  type:            'direct' | 'group' | 'channel',
  participantUids: string[],
  participantKey:  string | null,        // null for groups
  createdBy:       string,
  status:          'active' | 'archived' | 'disabled' | 'locked',
  lastMessage:     LastMessage | null,
  createdAt:       serverTimestamp,
  updatedAt:       serverTimestamp,

  // Phase 5 additions (group only)
  name:            string,                // 1..80 chars
  avatarUrl:       string | null,         // upload deferred — null for now
  ownerUid:        string,                // single owner, always in participantUids
  memberCount:     number,                // == participantUids.length, server-owned
  settings: {
    onlyAdminsCanSend:        boolean,    // default false
    onlyAdminsCanEditInfo:    boolean,    // default true
    onlyAdminsCanAddMembers:  boolean,    // default false
  },

  // back-compat aliases continue to be written alongside
  memberIds, lastMessageText, lastMessageAt, lastSenderId,
}
```

`conversations/{c}/members/{uid}` becomes the canonical role table:

```ts
{
  uid:                 string,
  role:                'owner' | 'admin' | 'member',
  displayNameSnapshot: string,            // captured at add time (cheap UI)
  photoURLSnapshot?:   string | null,
  status:              'active' | 'removed' | 'left',
  addedBy:             string,
  joinedAt:            serverTimestamp,
  updatedAt:           serverTimestamp,
}
```

Existing `members/{uid}` docs from Phase 0/4 (just `{ role }`) keep working — callable writes use `merge: true`, rules read `role` only.

### Callables (`functions/src/chats/`)

| Callable | Purpose | Audit action |
|---|---|---|
| `createGroup({ name, memberUids[], avatarUrl? })` | creator becomes owner, dedupes member list, caps at 256, builds `userState` for everyone | `group.created` |
| `addMembers({ conversationId, memberUids[] })` | owner/admin (respecting `onlyAdminsCanAddMembers`), dedupes, caps | `group.member.added` |
| `removeMember({ conversationId, memberUid })` | owner can remove anyone but themselves; admin can remove members only; owner-protection enforced | `group.member.removed` |
| `changeRole({ conversationId, memberUid, role })` | owner only; promote member↔admin; cannot touch owner role | `group.member.role_changed` |
| `leaveGroup({ conversationId })` | members + admins always; owner only when no other active members (otherwise → `failed-precondition` with `transfer-ownership-first`) | `group.member.left` |
| `lockGroup({ conversationId, locked })` | owner/admin; flips `conversations.status` between `active` and `locked` | `group.locked` / `group.unlocked` |

All callables go through `writeAuditLog`. Metadata never includes message content.

`sendTextMessage` is extended to:
1. Read the conversation's `status` and `settings`.
2. Reject sends when `status === 'locked'` unless the caller is owner/admin (with a clear `failed-precondition` / `permission-denied` code).
3. Reject when `settings.onlyAdminsCanSend === true` and the caller isn't owner/admin.
4. For groups, capture `senderDisplayName` + `senderPhotoURL` snapshots on the message doc (the chat UI uses them to render sender headers without joining `users`).

The mobile UI maps the new error codes to friendly strings.

### Rules

New helpers:

- `getMemberRole(convoId)` — reads `conversations/{c}/members/{auth.uid}.role`.
- `isConversationOwner(convoId)`, `isConversationAdmin(convoId)`, `isOwnerOrAdmin(convoId)`.
- `isActiveGroupMember(convoId)` — `members/{auth.uid}.status == 'active'` (treats missing status as active for back-compat with Phase 0 seed data).
- `isValidGroupRole(role)` — `role in ['owner', 'admin', 'member']`.

Rule changes:

- `conversations.create`: same as Phase 4 (the caller must be in `participantUids/memberIds`). Group-shape validation happens in the callable + a `request.resource.data.type == 'direct'` carve-out — direct conversations can still be created by clients via the existing `getOrCreateDirectConversation` path. Group conversations may only be created when the doc carries a self-referencing `ownerUid == auth.uid` so casual client-side group creation can't escalate.
- `members/{uid}.write`: tighten to **server-only writes for groups** (admins keep an admin-claim escape hatch); the Phase 0 `isGroupAdmin || isSelf(uid)` path remains for direct/legacy conversations.
- `messages.create`: keep the existing text-only / sender / length guard. The send-permission policy (locked / onlyAdminsCanSend) is enforced in the callable; rules don't need to read group settings (which would require an extra `get()` per write — expensive).

### Mobile UI

- **`ChatsList`**:
  - Enable the `Groups` filter chip (filters by `type === 'group'`).
  - Group rows render `name` + `memberCount` + last message preview + unread badge.
  - FAB opens an inline action sheet → "New chat" / "New group".

- **`NewGroup` (new)**: name input → user picker (reuses Phase 4 username search with multi-select chips) → create → navigate to the new conversation.

- **`Conversation`**:
  - Header for direct chats keeps peer name; for groups shows `name` + `memberCount` and is tappable into `GroupInfo`.
  - Message bubbles show `senderDisplayName` above incoming bubbles in groups.
  - Composer disables (with friendly inline message) when:
    - the conversation is `locked` and the caller isn't owner/admin, **or**
    - `onlyAdminsCanSend` and the caller isn't owner/admin, **or**
    - the caller isn't an `active` member.

- **`GroupInfo` (new)**: name + avatar placeholder + member-count badge + status pill, member list with role badges + per-row action sheet (promote / demote / remove, gated by role rules), "Lock/Unlock", "Leave group". All actions go through callables.

### i18n

Add `group.*` and `groupErrors.*` keys in `en.json` + `ar.json`.

### Indexes

- `conversations(participantUids array-contains, type ASC, updatedAt DESC)` — to support the "Groups" filter without an extra client-side scan.

The existing Phase 4 indexes (`participantUids, updatedAt`) still cover the default chat list.

### Member-count cap

`MAX_GROUP_MEMBERS = 256`. Enforced server-side in `createGroup` and `addMembers`. Rules don't enforce because they'd need to read `memberCount`, which they can — but it duplicates the check at the cost of an extra `get()`. Phase 20 will revisit.

### Audit metadata policy (groups)

| Action | metadata |
|---|---|
| `group.created` | `{ conversationId, memberCount }` |
| `group.member.added` | `{ conversationId, added: <count> }` |
| `group.member.removed` | `{ conversationId, memberUid, byRole }` |
| `group.member.role_changed` | `{ conversationId, memberUid, role }` |
| `group.member.left` | `{ conversationId, wasRole }` |
| `group.locked` / `group.unlocked` | `{ conversationId }` |

No message text, no phone numbers, no email addresses. The `auditLog` sanitiser is the safety net.

---

## Files expected to change

**Create**
- `docs/OFFLINESMS_PHASE_5_PLAN.md`
- `apps/mobile/src/screens/NewGroup.tsx`
- `apps/mobile/src/screens/GroupInfo.tsx`
- `apps/mobile/src/lib/groups.ts`
- `functions/src/chats/createGroup.ts`
- `functions/src/chats/addMembers.ts`
- `functions/src/chats/removeMember.ts`
- `functions/src/chats/changeRole.ts`
- `functions/src/chats/leaveGroup.ts`
- `functions/src/chats/lockGroup.ts`

**Edit**
- `firestore.rules`
- `firestore.indexes.json`
- `functions/src/index.ts`
- `functions/src/chats/sendTextMessage.ts` — locked / onlyAdminsCanSend / sender-snapshot
- `apps/mobile/App.tsx` — register NewGroup, GroupInfo
- `apps/mobile/src/lib/conversations.ts` — group-aware types + callable wrappers
- `apps/mobile/src/screens/ChatsList.tsx` — enable Groups chip, NewChat menu
- `apps/mobile/src/screens/Conversation.tsx` — group header, sender names, composer gates
- `apps/mobile/src/i18n/{en,ar}.json`
- `docs/OFFLINESMS_{DATA_MODEL,PHASE_LOG,TECHNICAL_ARCHITECTURE,RISK_REGISTER,DESIGN_IMPLEMENTATION_MAP}.md`

---

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Tightened `members.write` breaks the existing direct-chat seed / Phase 0 docs | Low | Medium | Group-only gate keyed on `conversations.type == 'group'`; direct / channel paths keep the Phase 0 rule. |
| `createGroup` over-allocates user state docs on huge member lists | Low | Low | Cap at 256; one batched write. |
| Race: two admins changing the same member's role concurrently | Low | Low | Last-writer-wins on `members/{uid}`; `addedBy` tracks the most recent actor. |
| Owner leaves group with members still present → orphaned ownership | Low | High | `leaveGroup` rejects when caller is owner with other active members; owner-transfer is deferred to Phase 6+ (documented). |
| Locked group still lets in-flight client writes succeed | Low | Medium | `sendTextMessage` callable re-checks status on every send; rules permit text but the callable refuses. |
| Group conversations leak via the dashboard `/admin/chats` list | Low | High | Dashboard moderation is Phase 14; the current scaffold pages show only EmptyState (Phase 1). No new dashboard work. |

---

## Rollback plan

- All changes live on the branch; no production deploy.
- Each commit is scoped: rules / callables / mobile UI revert independently.
- Reverting the rules commit reopens the pre-Phase-5 group-member write surface — acceptable because no production data exists.

---

## Test plan

The repo still has no automated harness — Phase 20.

- `npm run typecheck --workspaces --if-present` — green.
- `npm run lint --workspaces --if-present` — green.
- `npm run build --workspaces --if-present` — green.

**Manual emulator checklist (mirrors the spec's checklist):**

1. User A creates a group with {B, C} → `members` contains A (owner), B (member), C (member); all three have `userState` docs.
2. The group appears in A's, B's, C's chat list. The "Groups" chip filters to it.
3. B sends a text message → A and C see it; sender header shows B's name.
4. B tries to add a member → rejected (`onlyAdminsCanAddMembers` defaults false → allowed; toggle on and re-test → rejected).
5. A promotes B to admin (owner → ok). B promotes C to admin (admin → rejected, only owner can change roles).
6. A removes C → C is gone from `participantUids`, can't read messages.
7. A tries to leave → `failed-precondition` with `transfer-ownership-first`.
8. A locks the group → B (now admin) can still send; if A had demoted B first, B's send would be `permission-denied`.
9. C (removed) tries to read conversation → denied.
10. Audit log shows `group.created`, `group.member.added`, `group.member.role_changed`, `group.member.removed`, `group.locked`, `group.unlocked` events with sanitised metadata.
11. Phase 4 direct chats still work end-to-end.
12. Phase 1 admin guard, Phase 2 profile completion, Phase 3 system-owned writes still rejected.

---

## Acceptance criteria

1. Plan committed.
2. Group conversation contract + member contract documented.
3. Group reads restricted to active members.
4. Owner/admin gates enforced in rules + callables.
5. Six group callables exist, audited.
6. `sendTextMessage` respects `locked` + `onlyAdminsCanSend`.
7. `NewGroup`, `GroupInfo`, updated `ChatsList`, updated `Conversation` ship.
8. Groups filter chip enabled.
9. Group messages show sender names above incoming bubbles.
10. Normal members cannot manage roles.
11. Removed / left members can't read or send.
12. No private message content in audit logs.
13. typecheck / lint / build green.
14. Phase 1 / 2 / 3 / 4 still work.
15. Phase log updated.

---

## Commit plan

1. `docs: add OfflineSMS phase 5 implementation plan`
2. `feat(data): add group conversation contracts and indexes`
3. `security: add group member and conversation rules`
4. `feat(functions): add group management callables`
5. `feat(mobile): add new group creation flow`
6. `feat(mobile): add group conversation support`
7. `feat(mobile): add group info and member management`
8. `docs: update phase log for phase 5`
