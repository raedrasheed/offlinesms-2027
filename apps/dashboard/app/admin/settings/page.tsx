import Topbar from '@/components/Topbar';
import { EmptyState } from '@/components/state';

export default function SettingsAdmin() {
  return (
    <>
      <Topbar title="System settings" subtitle="Branding · localization · privacy · audit"/>
      <div className="p-7">
        <div className="bg-bg-surface rounded-2xl shadow-sh1 p-8">
          <EmptyState
            title="System settings aren’t available yet"
            description="A future phase will surface branding, localization, privacy, and audit settings."
          />
        </div>
      </div>
    </>
  );
}
