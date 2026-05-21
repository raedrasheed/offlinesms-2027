import Topbar from '@/components/Topbar';
import { EmptyState } from '@/components/state';

export default function Roles() {
  return (
    <>
      <Topbar title="Roles & permissions" subtitle="Custom claims · admin · moderator · support"/>
      <div className="p-7">
        <div className="bg-bg-surface rounded-2xl shadow-sh1 p-8">
          <EmptyState
            title="Role manager isn’t available yet"
            description="A future phase will let an administrator manage roles and permissions, with every change captured in an audit log."
          />
        </div>
      </div>
    </>
  );
}
