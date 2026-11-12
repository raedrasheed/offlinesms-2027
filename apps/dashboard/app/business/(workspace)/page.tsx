import { ArrowRight, Send } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getOrgMessagingOverview, listOrgMessageBatches } from '@/lib/orgMessagingData';
import { listRecipientGroups } from '@/lib/orgRecipientGroups';
import { BatchTable, Metrics, Status } from './WorkspaceContent';
import { getBusinessOrganizationId } from './workspaceSession';
import styles from './workspace.module.css';

export const metadata = { title: 'Overview' };

export default async function BusinessOverview() {
  const organizationId = await getBusinessOrganizationId();
  const [overview, batches, groups] = await Promise.all([
    getOrgMessagingOverview(organizationId),
    listOrgMessageBatches(organizationId, 5),
    listRecipientGroups(organizationId),
  ]);
  if (!overview) notFound();

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <h1>Messaging overview</h1>
          <p>{overview.name}</p>
        </div>
        <a className={styles.button} href="/send"><Send size={16} aria-hidden="true" /> New message</a>
      </header>

      <section aria-label="Workspace usage">
        <div className={styles.cardHeading}>
          <h2 className="text-base font-bold">Usage this month</h2>
          <Status value={overview.status} />
        </div>
        <Metrics items={[
          { label: 'Messages accepted', value: overview.usedThisMonth },
          { label: 'Monthly limit', value: overview.monthlyMessageLimit },
          { label: 'Remaining', value: overview.remainingThisMonth },
          { label: 'SMS wallet', value: overview.smsWalletBalance == null ? '—' : `${overview.smsWalletBalance.toLocaleString('en')} pts` },
        ]} />
        <p className="mt-3 text-right">
          <a href="/points" className={styles.link}>Request points <ArrowRight size={14} className="inline" aria-hidden="true" /></a>
        </p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeading}>
          <h2>Recipient groups</h2>
          <a href="/groups" className={styles.link}>Manage groups <ArrowRight size={14} className="inline" aria-hidden="true" /></a>
        </div>
        <p className={styles.cardIntro}>{groups.length} saved {groups.length === 1 ? 'group' : 'groups'}. Import an Excel workbook to build a reusable list.</p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeading}>
          <h2>Recent messages</h2>
          <a href="/activity" className={styles.link}>View activity <ArrowRight size={14} className="inline" aria-hidden="true" /></a>
        </div>
        <BatchTable batches={batches} />
      </section>
    </div>
  );
}
