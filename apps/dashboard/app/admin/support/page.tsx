import Topbar from '@/components/Topbar';
import { EmptyState } from '@/components/state';

export default function Support() {
  return (
    <>
      <Topbar title="Support" subtitle="Tickets, abuse reports, safety queue"/>
      <div className="p-7">
        <div className="bg-bg-surface rounded-2xl shadow-sh1 p-8">
          <EmptyState
            title="Support tools aren’t available yet"
            description="A future phase will introduce a ticket queue and abuse reports."
          />
        </div>
      </div>
    </>
  );
}
