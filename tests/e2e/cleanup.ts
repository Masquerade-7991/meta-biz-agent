// Drops leftover throwaway databases (meta_agent_e2e_*) that a run couldn't drop, e.g. after a
// network drop or a killed process. Touches nothing else.   node tests/e2e/cleanup.ts
import { MongoClient } from 'mongodb'
import { mongoUri } from './harness.ts'

const client = new MongoClient(mongoUri(), { serverSelectionTimeoutMS: 15_000 })
await client.connect()
try {
  const { databases } = await client.db().admin().listDatabases({ nameOnly: true })
  const left = databases.map((d) => d.name).filter((n) => /^meta_agent_e2e_[a-z0-9_]+$/.test(n))
  for (const name of left) await client.db(name).dropDatabase()
  console.log(left.length ? `dropped ${left.join(', ')}` : 'no leftover e2e databases')
} finally {
  await client.close()
}
