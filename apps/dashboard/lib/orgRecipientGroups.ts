import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { isRecipientGroupId, parseGroupRecipient, RECIPIENT_GROUP_MAX, type GroupRecipient } from './recipientGroupValidation';

export type RecipientGroupSummary = { id: string; name: string; memberCount: number };

function groupCollection(organizationId: string) {
  return adminDb.collection('organizations').doc(organizationId).collection('recipientGroups');
}

export async function listRecipientGroups(organizationId: string): Promise<RecipientGroupSummary[]> {
  const rows = await groupCollection(organizationId).orderBy('name').select('name', 'memberCount').get();
  return rows.docs.map(doc => ({ id: doc.id, name: doc.get('name'), memberCount: doc.get('memberCount') }));
}

export async function getRecipientGroup(organizationId: string, groupId: unknown) {
  if (!isRecipientGroupId(groupId)) return null;
  const doc = await groupCollection(organizationId).doc(groupId).get();
  if (!doc.exists) return null;
  return { id: doc.id, name: doc.get('name') as string, members: (doc.get('members') ?? []) as GroupRecipient[] };
}

export async function saveRecipientGroupImport(
  organizationId: string,
  actorUid: string,
  input: { groupId: string; newGroupName?: string; recipients: unknown },
) {
  if (!isRecipientGroupId(input.groupId)) return { error: 'Select a valid group.' };
  const name = typeof input.newGroupName === 'string' ? input.newGroupName.trim() : '';
  if (input.newGroupName !== undefined && (!name || name.length > 80)) return { error: 'Enter a group name of 1–80 characters.' };
  if (!Array.isArray(input.recipients) || !input.recipients.length || input.recipients.length > RECIPIENT_GROUP_MAX) {
    return { error: `Import between 1 and ${RECIPIENT_GROUP_MAX} recipients.` };
  }
  const parsed = input.recipients.map(parseGroupRecipient);
  if (parsed.some(recipient => recipient === null)) return { error: 'The import contains invalid recipient data.' };
  const recipients = parsed as GroupRecipient[];
  const org = adminDb.collection('organizations').doc(organizationId);
  const group = groupCollection(organizationId).doc(input.groupId);
  const audit = adminDb.collection('auditLogs').doc();

  return adminDb.runTransaction(async tx => {
    const [organization, current] = await tx.getAll(org, group);
    if (!organization.exists) return { error: 'Organization not found.' };
    if (organization.get('status') !== 'active') return { error: 'This organization is not active.' };
    if (!current.exists && !name) return { error: 'Group not found.' };
    if (current.exists && name && current.get('name') !== name) return { error: 'Choose an existing group or start a new import.' };

    const members = (current.get('members') ?? []) as GroupRecipient[];
    const existingPhones = new Set(members.map(member => member.phone));
    const added: GroupRecipient[] = [];
    for (const recipient of recipients) {
      if (existingPhones.has(recipient.phone)) continue;
      existingPhones.add(recipient.phone);
      added.push(recipient);
    }
    const memberCount = members.length + added.length;
    if (memberCount > RECIPIENT_GROUP_MAX) return { error: `A group can contain up to ${RECIPIENT_GROUP_MAX} recipients.` };
    if (added.length) {
      const now = FieldValue.serverTimestamp();
      const roster = { members: [...members, ...added], memberCount, updatedAt: now };
      if (current.exists) tx.update(group, roster);
      else tx.create(group, { ...roster, name, createdAt: now, createdBy: actorUid });
      tx.create(audit, {
        action: 'organization.recipient_group.imported', actorUid, targetType: 'recipientGroup', targetId: group.id,
        result: 'success', metadata: { organizationId, added: added.length, skipped: recipients.length - added.length },
        createdAt: now,
      });
    }
    return { groupId: group.id, added: added.length, skipped: recipients.length - added.length, memberCount };
  });
}
