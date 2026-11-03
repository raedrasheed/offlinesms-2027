import { notFound } from 'next/navigation';
import { getAdminClip } from '@/lib/clipAdminData';
import ClipReviewPanel from './ClipReviewPanel';
export default async function ClipReviewPage({ params }: { params: { clipId: string } }) {
  const clip = await getAdminClip(params.clipId);
  if (!clip) notFound();
  return <ClipReviewPanel key={clip.id} clip={clip} />;
}
