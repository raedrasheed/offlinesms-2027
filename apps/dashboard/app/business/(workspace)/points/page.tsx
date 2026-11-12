import { getBusinessPointsData } from '@/lib/businessPoints';
import { displayDate, Metrics, PageHeading } from '../WorkspaceContent';
import { getBusinessOrganizationId } from '../workspaceSession';
import styles from '../workspace.module.css';
import RequestPointsForm from './RequestPointsForm';
import pointsStyles from './points.module.css';

export const metadata = { title: 'OfflineSMS Points' };

const requestStatusKinds = {
  pending: 'warning',
  approved: 'good',
  rejected: 'bad',
};

export default async function BusinessPointsPage() {
  const organizationId = await getBusinessOrganizationId();
  const { reserved, available, packages, requests } = await getBusinessPointsData(organizationId);
  const formatPoints = (points: number) => `${points.toLocaleString('en')} pts`;

  return (
    <div className={styles.page}>
      <PageHeading title="OfflineSMS Points" description="Manage your organization’s SMS wallet and points requests." />
      <Metrics items={[
        { label: 'Available points', value: formatPoints(available) },
        { label: 'Reserved points', value: formatPoints(reserved) },
      ]} />

      <div className={styles.split}>
        <section className={styles.card} aria-labelledby="request-points">
          <h2 id="request-points">Request points</h2>
          <p className={styles.cardIntro}>Once approved, points are added to your organization’s SMS wallet.</p>
          <RequestPointsForm packages={packages} hasPending={requests.some(request => request.status === 'pending')} />
        </section>

        <section className={styles.card} aria-labelledby="points-history">
          <div className={styles.cardHeading}><h2 id="points-history">Request history</h2></div>
          {requests.length ? (
            <ul className={pointsStyles.requests}>
              {requests.map(request => (
                <li key={request.id}>
                  <div className={pointsStyles.requestHeader}>
                    <div>
                      <h3 dir="auto">{request.packageName}</h3>
                      <p>
                        {formatPoints(request.points)}
                        {request.createdAt && <> · <time dateTime={request.createdAt}>{displayDate(request.createdAt)}</time></>}
                      </p>
                    </div>
                    <span className={styles.status} data-kind={requestStatusKinds[request.status]}>{request.status}</span>
                  </div>
                  {request.note && <p className={pointsStyles.requestNote}><strong>Your note</strong> <span dir="auto">{request.note}</span></p>}
                  {request.reviewNote && <p className={pointsStyles.requestNote}><strong>Review note</strong> <span dir="auto">{request.reviewNote}</span></p>}
                </li>
              ))}
            </ul>
          ) : <p className={styles.empty}>You haven’t requested any points yet.</p>}
        </section>
      </div>
    </div>
  );
}
