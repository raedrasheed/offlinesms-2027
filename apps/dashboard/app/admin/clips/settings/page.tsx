import { getClipAdminSettings } from '@/lib/clipAdminData';
import ClipSettingsForm from './ClipSettingsForm';
export default async function ClipSettingsPage() {
  const { config, version } = await getClipAdminSettings();
  return <ClipSettingsForm key={version} config={config} version={version} />;
}
