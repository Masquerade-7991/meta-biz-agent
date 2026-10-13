import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { template: '%s · Helo.ai docs', default: 'Helo.ai docs' },
  description: 'How to use the Helo.ai console for the WhatsApp Business Agent, and how it is built.',
  icons: '/favicon.svg',
};

// Self-hosted by Next. Each exposes a variable; global.css builds the font stacks from them.
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap', variable: '--font-inter' });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['600', '700'], display: 'swap', variable: '--font-jakarta' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], display: 'swap', variable: '--font-jetbrains' });

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
