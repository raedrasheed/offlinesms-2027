import Topbar from '@/components/Topbar';
export default function ChatsAdmin() {
  return (
    <>
      <Topbar title="Chats" subtitle="Browse and moderate all conversations"/>
      <div className="p-7">
        <div className="bg-white rounded-2xl shadow-sh1 p-8 text-center text-sm text-ink-500">
          {/* TODO: list conversations from Firestore with member counts, last activity, moderation tools */}
          Conversation list — TODO. Query <code>collection(db, &apos;conversations&apos;)</code> with admin SDK.
        </div>
      </div>
    </>
  );
}
