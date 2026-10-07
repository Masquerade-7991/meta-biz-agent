// npm run docs:openapi — writes the API description (server/openapi) to docs/openapi.json, for
// Postman, Insomnia or an OpenAPI viewer. server/openapi.test.ts fails while this file is stale.
import { mkdirSync, writeFileSync } from 'node:fs'
import { openapi } from '../server/openapi/index.ts'

mkdirSync(new URL('../docs/', import.meta.url), { recursive: true })
writeFileSync(new URL('../docs/openapi.json', import.meta.url), JSON.stringify(openapi, null, 2) + '\n')
console.log('docs/openapi.json written')
