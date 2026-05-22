import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OfflineSMS · Admin',
  description: 'Admin dashboard for the OfflineSMS messaging platform.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body>
        {/* Runs synchronously before first paint to restore saved theme without flash */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(localStorage.getItem('theme')==='light')document.documentElement.classList.add('light')}catch(e){}})()` }} />
        <a href="#main-content" className="skip-nav">Skip to main content</a>
        {children}
      </body>
    </html>
  );
}
