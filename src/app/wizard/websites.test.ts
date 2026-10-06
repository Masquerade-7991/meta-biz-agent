import assert from 'node:assert/strict'
import test from 'node:test'
import { coveredBy, siteView } from './websites.ts'

test('completed with 0 pages is Ready, and never claims 0 pages', () => {
  const v = siteView({ status: 'done', pagesRead: 0 })
  assert.equal(v.label, 'Ready')
  assert.doesNotMatch(v.line, /0 page/)
  assert.match(siteView({ status: 'done', pagesRead: 14 }).line, /14 pages/)
})

test('each Meta state maps to a plain stage, with the step while it runs', () => {
  assert.equal(siteView({ status: 'waiting', pagesRead: 0 }).step, 0)
  assert.equal(siteView({ status: 'reading', pagesRead: 3 }).step, 1)
  assert.equal(siteView({ status: 'done_no_data', pagesRead: 0 }).stage, 'empty')
  assert.equal(siteView({ status: 'failed', pagesRead: 0, crawlError: 'robots' }).line, 'Meta couldn’t read it: robots')
  assert.equal(siteView({ status: 'reading', pagesRead: 0, stalled: true }).stage, 'slow')
})

test('a page under a listed site on the same domain is already covered', () => {
  const sites = [{ url: 'https://helo.ai/' }, { url: 'https://other.com/docs' }]
  assert.equal(coveredBy('https://helo.ai/company/about', sites)?.url, 'https://helo.ai/')
  assert.equal(coveredBy('https://www.helo.ai/pricing', sites)?.url, 'https://helo.ai/')
  assert.equal(coveredBy('https://helo.ai/', sites), undefined)
  assert.equal(coveredBy('https://other.com/docsx', sites), undefined)
  assert.equal(coveredBy('https://other.com/docs/start', sites)?.url, 'https://other.com/docs')
})
