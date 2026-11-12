'use client';

import { useActionState } from 'react';
import { requestBusinessPoints } from '@/lib/businessPointsActions';
import styles from '../workspace.module.css';
import pointsStyles from './points.module.css';

export default function RequestPointsForm({
  packages,
  hasPending,
}: {
  packages: { id: string; name: string; points: number }[];
  hasPending: boolean;
}) {
  const [state, formAction, isSubmitting] = useActionState(requestBusinessPoints, null);

  if (state && 'success' in state) {
    return <p className={styles.note} role="status">Your points request was submitted for review.</p>;
  }
  if (hasPending) {
    return <p className={styles.note}>You already have a request awaiting review.</p>;
  }
  if (!packages.length) {
    return <p className={styles.empty}>No points packages are currently available.</p>;
  }

  return (
    <form action={formAction}>
      <fieldset className={pointsStyles.fields} disabled={isSubmitting}>
        <label htmlFor="points-package">
          Points package
          <select id="points-package" name="packageId" defaultValue="" required>
            <option value="" disabled>Select a package</option>
            {packages.map(pkg => <option key={pkg.id} value={pkg.id}>{pkg.name} · {pkg.points.toLocaleString('en')} pts</option>)}
          </select>
        </label>
        <label htmlFor="points-request-note">
          Note (optional)
          <textarea id="points-request-note" name="note" rows={3} maxLength={300} dir="auto" />
        </label>
        {state && 'error' in state && <p className={pointsStyles.error} role="alert">{state.error}</p>}
        <button className={styles.button} type="submit">{isSubmitting ? 'Submitting…' : 'Submit request'}</button>
      </fieldset>
    </form>
  );
}
