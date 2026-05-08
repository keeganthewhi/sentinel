import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Sentinel Dashboard',
  description: 'Local-only Sentinel scan dashboard',
};

export const viewport: Viewport = { themeColor: '#0b0b0d' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-[var(--color-border)] px-6 py-4 flex items-center gap-3">
          <a href="/" className="font-semibold tracking-tight text-[var(--color-fg)]">
            Sentinel
          </a>
          <span className="text-xs text-[var(--color-muted)]">local dashboard</span>
        </header>
        <main className="px-6 py-6 max-w-6xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
