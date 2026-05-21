import Topbar from '@/components/Topbar';
import { EmptyState } from '@/components/state';

export default function Reports() {
  return (
    <>
      <Topbar title="Reports" subtitle="Usage, billing, deliverability, compliance"/>
      <div className="p-7">
        <div className="bg-bg-surface rounded-2xl shadow-sh1 p-8">
          <EmptyState
            title="Reports aren’t available yet"
            description="A future phase will deliver usage, billing, and deliverability reports with phone-number masking by default."
          />
        </div>
      </div>
    </>
  );
}
