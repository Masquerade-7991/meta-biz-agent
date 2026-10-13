import Link from 'next/link';
import { FullSearchTrigger } from 'fumadocs-ui/layouts/shared/slots/search-trigger';
import { ArrowRight, BookOpen, Code, Inbox, Megaphone, Smartphone, Sparkles } from 'lucide-react';

const SECTIONS = [
  {
    href: '/docs/guide',
    icon: BookOpen,
    title: 'Guide',
    body: 'Connect your WhatsApp number, build your AI agent, and run your support desk with your team.',
  },
  {
    href: '/docs/developers',
    icon: Code,
    title: 'Developers',
    body: 'How the console is built, how it talks to Meta, how to run and test it, and the full API reference.',
  },
];

const TASKS = [
  { href: '/docs/guide/connect-number', icon: Smartphone, label: 'Connect a number' },
  { href: '/docs/guide/build-agent', icon: Sparkles, label: 'Build your AI agent' },
  { href: '/docs/guide/inbox', icon: Inbox, label: 'Take over a chat' },
  { href: '/docs/guide/broadcasts', icon: Megaphone, label: 'Send your first broadcast' },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 pt-20 pb-24 sm:pt-28">
      <p className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border bg-fd-card/70 px-3 py-1 text-xs text-fd-muted-foreground backdrop-blur">
        <span className="size-1.5 rounded-full bg-fd-primary" />
        WhatsApp Business Agent, run by Meta, set up in Helo.ai
      </p>
      <h1 className="max-w-2xl font-display text-4xl font-bold tracking-tight text-(--text-strong) text-balance sm:text-5xl">
        Everything you need to run WhatsApp support with AI and your team.
      </h1>
      <p className="mt-5 max-w-xl text-base text-fd-muted-foreground sm:text-lg">
        Step-by-step guides for the Helo.ai console, written from Meta&rsquo;s rules and our own product.
      </p>

      <FullSearchTrigger className="mt-8 w-full max-w-md rounded-xl bg-fd-card/80 p-3 backdrop-blur" />

      <div className="mt-14 grid gap-4 sm:grid-cols-2">
        {SECTIONS.map(({ href, icon: Icon, title, body }) => (
          <Link
            key={href}
            href={href}
            data-card="true"
            className="group rounded-xl border p-6 text-fd-card-foreground"
          >
            <Icon className="size-5 text-fd-primary" aria-hidden />
            <h2 className="mt-4 flex items-center gap-1.5 font-display text-lg font-semibold tracking-tight text-(--text-strong)">
              {title}
              <ArrowRight className="size-4 text-fd-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
            </h2>
            <p className="mt-1.5 text-sm text-fd-muted-foreground">{body}</p>
          </Link>
        ))}
      </div>

      <h2 className="mt-14 text-sm font-medium text-fd-muted-foreground">Popular tasks</h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {TASKS.map(({ href, icon: Icon, label }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
            >
              <Icon className="size-4 text-fd-muted-foreground" aria-hidden />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
