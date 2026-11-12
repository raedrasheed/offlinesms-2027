import { notFound } from 'next/navigation';
import { getOrgMessageBatch, listBatchMessages, MESSAGE_ROWS_MAX } from '@/lib/orgMessagingData';
import { isRecipientGroupId } from '@/lib/recipientGroupValidation';
import { Metrics, PageHeading, Status, displayDate } from '../../WorkspaceContent';
import { getBusinessOrganizationId } from '../../workspaceSession';
import styles from '../../workspace.module.css';

export const metadata = { title: 'Message batch' };

export default async function BusinessBatch({ params }: { params: Promise<{ batchId: string }> }) {
  const organizationId = await getBusinessOrganizationId();
  const { batchId } = await params;
  if (!isRecipientGroupId(batchId)) notFound();
  const batch = await getOrgMessageBatch(batchId);
  if (!batch || batch.organizationId !== organizationId) notFound();
  const messages = await listBatchMessages(batch.id);

  return (
    <div className={styles.page}>
      <PageHeading title="Message batch" description={batch.id}
        action={<a className={styles.link} href="/activity">← Back to activity</a>} />
      <section className={styles.card} aria-labelledby="batch-summary">
        <div className={styles.cardHeading}><h2 id="batch-summary">Delivery summary</h2><Status value={batch.status} /></div>
        <div className={styles.meta}>
          <span>{batch.source === 'api' ? 'API' : 'Workspace'}</span>
          <span>{displayDate(batch.createdAt)}</span>
          <span>SMS escalation <Status value={batch.escalationStatus} /></span>
        </div>
        <Metrics items={[
          { label: 'Recipients', value: batch.total },
          { label: 'Accepted', value: batch.accepted },
          { label: 'In-app delivered', value: batch.delivered },
          { label: 'In-app read', value: batch.read },
          { label: 'Failed', value: batch.failed },
          { label: 'Unsupported', value: batch.unsupported },
        ]} />
      </section>
      <section className={styles.card} aria-labelledby="message-recipients">
        <div className={styles.cardHeading}><h2 id="message-recipients">Recipient activity</h2></div>
        {batch.total > MESSAGE_ROWS_MAX && <p className={styles.cardIntro}>Showing up to {MESSAGE_ROWS_MAX} recipients.</p>}
        {messages.length ? (
          <div className={styles.scroll} tabIndex={0} aria-label="Recipient activity" role="region">
            <table className={styles.table}>
              <thead><tr>{['Recipient', 'Message', 'In-app', 'SMS', 'Failure reason', 'Created'].map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
              <tbody>
                {messages.map(message => (
                  <tr key={message.id}>
                    <td>{message.recipientValue}</td>
                    <td className="min-w-40 max-w-80 break-words" dir="auto">{message.body}</td>
                    <td>{message.smsOnly ? 'SMS only' : <Status value={message.status} />}</td>
                    <td>{message.smsEscalation ? <Status value={message.smsEscalation} /> : '—'}</td>
                    <td>{(message.failureReason ?? message.smsSkipReason)?.replace(/[_-]/g, ' ') ?? '—'}</td>
                    <td>{displayDate(message.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className={styles.empty}>No recipient activity has been recorded.</p>}
      </section>
    </div>
  );
}
