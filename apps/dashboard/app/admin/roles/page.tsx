import Topbar from '@/components/Topbar';
export default function Roles() {
  return (
    <>
      <Topbar title="Roles & permissions" subtitle="Custom claims · admin · moderator · support"/>
      <div className="p-7"><div className="bg-white rounded-2xl shadow-sh1 p-8 text-center text-sm text-ink-500">Role manager — TODO. Mutates Firebase custom claims via Cloud Function.</div></div>
    </>
  );
}
