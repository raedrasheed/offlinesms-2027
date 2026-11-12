import ApiKeySection from '@/app/admin/organization-messaging/ApiKeySection';
import { generateOrgApiKey, revokeOrgApiKey } from '@/lib/orgMessagingActions';
import { getOrgApiKeyStatus } from '@/lib/orgMessagingData';
import { PageHeading } from '../WorkspaceContent';
import { getBusinessOrganizationId } from '../workspaceSession';
import styles from '../workspace.module.css';

export const metadata = { title: 'API access' };

const example = JSON.stringify({
  recipientGroupId: 'YOUR_GROUP_ID',
  title: 'Office hours',
  body: 'We will reopen at 9:00 tomorrow.',
}, null, 2);

export default async function BusinessIntegrations() {
  const organizationId = await getBusinessOrganizationId();
  const status = await getOrgApiKeyStatus(organizationId);

  return (
    <div className={styles.page}>
      <PageHeading title="API access" description="Connect your organization’s system to OfflineSMS." />
      <section className={styles.card} aria-labelledby="api-key">
        <div className={styles.cardHeading}><h2 id="api-key">Organization API key</h2></div>
        <ApiKeySection status={status} generateAction={generateOrgApiKey.bind(null, organizationId)}
          revokeAction={revokeOrgApiKey.bind(null, organizationId)} />
      </section>
      <section className={styles.card} aria-labelledby="api-example">
        <h2 id="api-example">Send to a saved group</h2>
        <p className={styles.cardIntro}>Copy the group ID from <a href="/groups" className={styles.link}>Groups</a> and call the messaging API from your server.</p>
        <p className={styles.cardIntro}><code>POST /api/v1/org/messages/send</code> with <code>Authorization: Bearer YOUR_API_KEY</code> and a JSON body.</p>
        <pre className={styles.code}>{example}</pre>
        <p className={styles.cardIntro}>Check the batch status under <a href="/activity" className={styles.link}>Activity</a>.</p>
      </section>
    </div>
  );
}
