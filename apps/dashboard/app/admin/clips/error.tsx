'use client';
export default function ClipsError({ reset }: { reset: () => void }) {
  return <div className="rounded-xl border p-6 space-y-3" role="alert">
    <p>Clips could not be loaded. Your settings have not been changed.</p>
    <button onClick={reset} className="rounded-lg px-4 py-2 text-white" style={{ background: '#1F7BA8' }}>Try again</button>
  </div>;
}
