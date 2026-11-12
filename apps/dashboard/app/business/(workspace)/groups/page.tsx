import RecipientGroups from '@/app/admin/organization-messaging/RecipientGroups';
import { importOrganizationRecipients, manageOrganizationRecipients } from '@/lib/orgMessagingActions';
import { getRecipientGroup, listRecipientGroups } from '@/lib/orgRecipientGroups';
import { PageHeading } from '../WorkspaceContent';
import { getBusinessOrganizationId } from '../workspaceSession';
import styles from '../workspace.module.css';

export const metadata = { title: 'Groups' };

export default async function BusinessGroups({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const organizationId = await getBusinessOrganizationId();
  const { group } = await searchParams;
  const [groups, selected] = await Promise.all([
    listRecipientGroups(organizationId),
    getRecipientGroup(organizationId, group),
  ]);
  return (
    <div className={styles.page}>
      <PageHeading title="Groups" description="Import contacts from Excel and organize them into lists you can message later." />
      <RecipientGroups
        organizationId={organizationId}
        groups={groups}
        selected={selected}
        action={importOrganizationRecipients.bind(null, organizationId)}
        manageAction={manageOrganizationRecipients.bind(null, organizationId)}
        groupPath="/groups"
      />
    </div>
  );
}
