import './globals.css';
import { Space_Mono } from 'next/font/google';

const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono'
});

export const metadata = {
  title: 'Sui Transaction Explainer',
  description: 'Plain-language Sui transaction explanations in under three seconds.'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${spaceMono.variable}`}>
      <body>
        <div className="page-glow" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
