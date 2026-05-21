import Topbar from '@/components/Topbar';
import { EmptyState } from '@/components/state';

export default function CallsAdmin() {
  return (
    <>
      <Topbar title="Calls" subtitle="Voice + video logs across the network"/>
      <div className="p-7">
        <div className="bg-bg-surface rounded-2xl shadow-sh1 p-8">
          <EmptyState
            title="Call logs aren’t available yet"
            description="Calls aren’t part of the current scope. This page is reserved for a future phase."
          />
        </div>
      </div>
    </>
  );
}
