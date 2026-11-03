import { notFound } from 'next/navigation';
import { getAdminPost } from '@/lib/postAdminData';
import { PostReview } from '../PostReview';
export default async function PostPage({params}: {params:Promise<{postId:string}>}) {
  const {postId}=await params;const post=await getAdminPost(postId);
  if(!post)notFound();
  return <PostReview key={`${post.id}:${post.version}`} post={post}/>;
}
