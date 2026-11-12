import { FieldValue } from 'firebase-admin/firestore';
import { DEFAULT_ESCALATION, deriveOrgSlug, type OrgStatus } from './orgMessagingValidation';

export function organizationAccountDocument(input: {
  organizationId: string;
  name: string;
  status: OrgStatus;
  adminUid: string;
  adminEmail: string;
  monthlyMessageLimit: number;
  createdBy: string;
}) {
  const now = FieldValue.serverTimestamp();
  return {
    name: input.name,
    slug: deriveOrgSlug(input.name, input.organizationId.slice(0, 6).toLowerCase()),
    status: input.status,
    ownerUid: input.adminUid,
    adminUid: input.adminUid,
    adminEmail: input.adminEmail,
    monthlyMessageLimit: input.monthlyMessageLimit,
    messagingEscalation: DEFAULT_ESCALATION,
    settings: {
      smsEscalationEnabled: false,
      pointsEnabled: false,
      defaultLanguage: 'en',
      timezone: 'UTC',
    },
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
  };
}
