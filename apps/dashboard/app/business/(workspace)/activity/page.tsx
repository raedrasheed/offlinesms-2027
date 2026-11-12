import { listOrgMessageBatches } from '@/lib/orgMessagingData';
import { BatchTable, PageHeading } from '../WorkspaceContent';
import { getBusinessOrganizationId } from '../workspaceSession';
import styles from '../workspace.module.css';

export const metadata = { title: 'Activity' };

export default async function BusinessActivity() {
  const organizationId = await getBusinessOrganizationId();
  const batches = await listOrgMessageBatches(organizationId);

  return (
    <div className={styles.page}>
      <PageHeading title="Activity" description="Check recent messages sent from your workspace or through the API."
        action={<a className={styles.button} href="/send">New message</a>} />
      <section className={styles.card} aria-labelledby="recent-batches">
        <div className={styles.cardHeading}><h2 id="recent-batches">Recent batches</h2></div>
        <BatchTable batches={batches} />
      </section>
    </div>
  );
}
