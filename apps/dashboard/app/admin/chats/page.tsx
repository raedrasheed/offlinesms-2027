import Topbar from '@/components/Topbar';
import { EmptyState } from '@/components/state';

export default function ChatsAdmin() {
  return (
    <>
      <Topbar title="Chats" subtitle="Browse and moderate all conversations"/>
      <div className="p-7">
        <div className="bg-bg-surface rounded-2xl shadow-sh1 p-8">
          <EmptyState
            title="Conversation moderation isn’t available yet"
            description="A future phase will list conversations with member counts, last activity, and moderation tools. Message content stays redacted by default."
          />
        </div>
      </div>
    </>
  );
}
