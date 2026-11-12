import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'OfflineSMS Business',
  description: 'Recipient groups and messaging for organizations.',
};

export default function BusinessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
