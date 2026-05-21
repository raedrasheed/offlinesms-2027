import Topbar from '@/components/Topbar';
import { EmptyState } from '@/components/state';

export default function GroupsAdmin() {
  return (
    <>
      <Topbar title="Groups & communities" subtitle="Group rosters, admin controls, communities"/>
      <div className="p-7">
        <div className="bg-bg-surface rounded-2xl shadow-sh1 p-8">
          <EmptyState
            title="Groups admin isn’t available yet"
            description="A future phase will list group and channel conversations with rosters and admin controls."
          />
        </div>
      </div>
    </>
  );
}
