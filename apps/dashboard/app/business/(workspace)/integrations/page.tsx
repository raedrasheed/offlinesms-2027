import ApiKeySection from '@/app/admin/organization-messaging/ApiKeySection';
import { generateOrgApiKey, revokeOrgApiKey } from '@/lib/orgMessagingActions';
import { getOrgApiKeyStatus } from '@/lib/orgMessagingData';
import { PageHeading } from '../WorkspaceContent';
import { getBusinessOrganizationId } from '../workspaceSession';
import styles from '../workspace.module.css';

export const metadata = { title: 'API access' };

const personalizedExample = JSON.stringify({
  messages: [
    { phone: '+12025550123', title: 'Appointment reminder', body: 'Hi Alex, your appointment is on Monday at 10:00.' },
    { userId: 'SECOND_RECIPIENT_USER_ID', title: 'Request update', body: 'Hi Sam, your request is ready to collect.' },
  ],
}, null, 2);

const groupExample = JSON.stringify({
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
      <section className={styles.card} aria-labelledby="api-personalized-example">
        <h2 id="api-personalized-example">Send a different message to each recipient</h2>
        <p className={styles.cardIntro}>From your server, call <code>POST /api/v1/org/messages/send</code> with <code>Authorization: Bearer YOUR_API_KEY</code> and <code>Content-Type: application/json</code>.</p>
        <p className={styles.cardIntro}>Use <code>messages</code> with a title and body for each recipient. Identify each recipient by an OfflineSMS user ID or an international phone number beginning with <code>+</code>.</p>
        <pre className={styles.code}>{personalizedExample}</pre>
        <p className={styles.cardIntro}>Use the returned <code>batchId</code> to check the batch under <a href="/activity" className={styles.link}>Activity</a>.</p>
      </section>
      <section className={styles.card} aria-labelledby="api-group-example">
        <h2 id="api-group-example">Send to a saved group</h2>
        <p className={styles.cardIntro}>Copy the group ID from <a href="/groups" className={styles.link}>Groups</a> and use this JSON body with the same endpoint.</p>
        <pre className={styles.code}>{groupExample}</pre>
      </section>
    </div>
  );
}
