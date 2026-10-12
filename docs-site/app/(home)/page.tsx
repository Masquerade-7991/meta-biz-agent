import { redirect } from 'next/navigation';

// The site is only docs; keep them under /docs so they can also be served from the console's domain.
export default function HomePage() {
  redirect('/docs');
}
