import Link from 'next/link';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';
import { ArrowLeft, BookOpen, Code } from 'lucide-react';

// Any address that isn't a page, and docs pages that don't exist: the landing page's header and
// backdrop, and a way on (instead of Next's bare 404).
export default function NotFound() {
  return (
    <HomeLayout {...baseOptions()}>
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-24">
      <p className="text-sm font-medium text-fd-primary">404</p>
      <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-(--text-strong)">This page doesn’t exist</h1>
      <p className="mt-3 text-fd-muted-foreground">
        The link may be old, or the page may have moved. Search the docs, or start from one of the sections.
      </p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <Link href="/docs/guide" data-card="true" className="flex items-center gap-3 rounded-xl border p-4 text-sm font-medium">
          <BookOpen className="size-4 text-fd-primary" aria-hidden />
          Guide
        </Link>
        <Link href="/docs/developers" data-card="true" className="flex items-center gap-3 rounded-xl border p-4 text-sm font-medium">
          <Code className="size-4 text-fd-primary" aria-hidden />
          Developers
        </Link>
      </div>
      <Link href="/" className="mt-6 inline-flex w-fit items-center gap-1.5 text-sm text-fd-muted-foreground hover:text-fd-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Back to the docs home
      </Link>
    </main>
    </HomeLayout>
  );
}
