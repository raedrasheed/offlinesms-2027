import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OfflineSMS · Admin',
  description: 'Admin dashboard for the OfflineSMS messaging platform.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
