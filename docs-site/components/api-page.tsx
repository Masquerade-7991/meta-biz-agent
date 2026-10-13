'use client';
import { createOpenAPIPage } from 'fumadocs-openapi/ui';

// No playground: the console's API answers only its own origin, with the member's session cookie,
// so "Try it" from the docs site could never succeed. The console's /api/docs (Swagger) is the place
// to try requests (see the API overview page).
export const OpenAPIPage = createOpenAPIPage({ playground: { enabled: false } });
