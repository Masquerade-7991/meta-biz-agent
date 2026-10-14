// Which commit this deployment was built from: `npm run docs:publish` waits for the hosted site to
// report the commit it pushed. Fixed at build time.
export const dynamic = 'force-static';

export function GET() {
  return Response.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    builtAt: new Date().toISOString(),
  });
}
