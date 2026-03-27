import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AIDeck — AI Presentations in One Click',
  description:
    'Generate stunning presentation decks from a simple text prompt. Get polished slides with animations and speaker notes instantly. Try AIDeck today.',
  keywords: [
    'AI presentations',
    'PowerPoint generator',
    'presentation maker',
    'AI slides',
    'deck generator',
  ],
  openGraph: {
    title: 'AIDeck — AI Presentations in One Click',
    description:
      'Generate stunning presentation decks from a simple text prompt. Polished slides with animations and speaker notes in seconds.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="bg-gray-950 text-white antialiased" style={{ fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
