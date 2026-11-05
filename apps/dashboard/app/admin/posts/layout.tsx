import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export default function PostsLayout({children: _children}: {children: React.ReactNode}) {
  notFound();
}
