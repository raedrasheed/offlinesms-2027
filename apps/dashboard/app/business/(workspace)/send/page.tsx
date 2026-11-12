import { notFound } from 'next/navigation';
import SendMessageForm from '@/app/admin/organization-messaging/SendMessageForm';
import EscalationSettings from '@/app/admin/organization-messaging/EscalationSettings';
import { sendOrganizationMessage, updateOrgEscalationSettings } from '@/lib/orgMessagingActions';
import { getOrgMessagingOverview } from '@/lib/orgMessagingData';
import { listRecipientGroups } from '@/lib/orgRecipientGroups';
import { PageHeading } from '../WorkspaceContent';
import { getBusinessOrganizationId } from '../workspaceSession';
import styles from '../workspace.module.css';

export const metadata = { title: 'New message' };

export default async function BusinessSend({ searchParams }: { searchParams: Promise<{ group?: string | string[] }> }) {
  const organizationId = await getBusinessOrganizationId();
  const [overview, groups, { group }] = await Promise.all([
    getOrgMessagingOverview(organizationId),
    listRecipientGroups(organizationId),
    searchParams,
  ]);
  if (!overview) notFound();
  const availableGroups = groups.filter(({ memberCount }) => memberCount > 0);
  const initialGroupId = availableGroups.find(({ id }) => id === group)?.id;

  return (
    <div className={styles.page}>
      <PageHeading title="New message" description="Choose a saved group or enter recipients and compose your message." />
      <div className={styles.split}>
        <section className={styles.card} aria-labelledby="compose-message">
          <h2 id="compose-message">Compose</h2>
          <p className={styles.cardIntro}>Messages reach registered recipients in the OfflineSMS app first.</p>
          {group !== undefined && !initialGroupId && (
            <p className={styles.cardIntro} role="alert">This group is unavailable or empty. Choose another group or enter recipients manually.</p>
          )}
          <SendMessageForm
            key={typeof group === 'string' ? group : ''}
            action={sendOrganizationMessage.bind(null, organizationId)}
            groups={availableGroups}
            initialGroupId={initialGroupId}
            batchPath="/activity"
          />
        </section>
        <section className={styles.card} aria-labelledby="sms-settings">
          <div className={styles.cardHeading}>
            <h2 id="sms-settings">SMS escalation</h2>
            <a href="/points" className={styles.link}>Request points</a>
          </div>
          <p className={styles.cardIntro}>SMS wallet <span className={styles.wallet}>{overview.smsWalletBalance == null ? '—' : `${overview.smsWalletBalance.toLocaleString('en')} pts`}</span></p>
          <EscalationSettings action={updateOrgEscalationSettings.bind(null, organizationId)} initial={overview.escalation} />
        </section>
      </div>
    </div>
  );
}
