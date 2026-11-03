import { notFound } from 'next/navigation';
import { getAdminClip } from '@/lib/clipAdminData';
import ClipReviewPanel from './ClipReviewPanel';
export default async function ClipReviewPage({ params: paramsPromise }: { params: Promise<{ clipId: string }> }) {
  const params = await paramsPromise;
  const clip = await getAdminClip(params.clipId);
  if (!clip) notFound();
  return <ClipReviewPanel key={clip.id} clip={clip} />;
}
