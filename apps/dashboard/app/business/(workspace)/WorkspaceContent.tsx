import type { ReactNode } from 'react';
import type { OrgBatchRow } from '@/lib/orgMessagingData';
import styles from './workspace.module.css';

export function PageHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className={styles.heading}>
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}

export function Metrics({ items }: { items: { label: string; value: string | number }[] }) {
  return (
    <dl className={styles.metrics}>
      {items.map(({ label, value }) => (
        <div key={label} className={styles.metric}>
          <dt className={styles.metricLabel}>{label}</dt>
          <dd className={styles.metricValue}>{typeof value === 'number' ? value.toLocaleString('en') : value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function displayDate(iso: string) {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : '—';
}

const statusKinds: Record<string, string> = {
  active: 'good', accepted: 'good', delivered: 'good', read: 'good', sent: 'good',
  partial: 'warning', unsupported_recipient: 'warning',
  failed: 'bad', suspended: 'bad', disabled: 'bad',
};

export function Status({ value }: { value: string }) {
  return <span className={styles.status} data-kind={statusKinds[value]}>{value.replaceAll('_', ' ')}</span>;
}

export function BatchTable({ batches }: { batches: OrgBatchRow[] }) {
  if (!batches.length) return <p className={styles.empty}>Sent messages will appear here.</p>;
  return (
    <div className={styles.scroll} tabIndex={0} aria-label="Message batches" role="region">
      <table className={styles.table}>
        <thead>
          <tr>
            {['Batch', 'Source', 'Status', 'Recipients', 'Delivered', 'Failed', 'Unsupported', 'Created'].map(column => <th key={column} scope="col">{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {batches.map(batch => (
            <tr key={batch.id}>
              <td><a className={styles.link} href={`/activity/${encodeURIComponent(batch.id)}`}>{batch.id.slice(0, 12)}…</a></td>
              <td>{batch.source === 'api' ? 'API' : 'Workspace'}</td>
              <td><Status value={batch.status} /></td>
              <td>{batch.total}</td>
              <td>{batch.delivered}</td>
              <td>{batch.failed}</td>
              <td>{batch.unsupported}</td>
              <td>{displayDate(batch.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
