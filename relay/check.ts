// Self-check for the relay: `bun relay/check.ts`. Exits non-zero if the logic breaks.
import assert from 'node:assert/strict'

import { handle, options } from './server'

const TOKEN = 'a'.repeat(64)
let caller = 0 // each request from its own address, unless a check names one
const request = (path: string, init: RequestInit = {}, token = TOKEN, address = `10.0.0.${++caller}`) =>
  handle(new Request(`http://relay${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'x-real-ip': address } }))
const post = (data: string, token = TOKEN) => request('/messages', { method: 'POST', body: data }, token)
const read = async (query = '', token = TOKEN) => (await (await request(`/messages${query}`, {}, token)).json()).messages
const blobs = (messages: { data: string }[]) => messages.map(message => message.data)

// Only a room id is taken: the hash the mod sends, never a guessable name.
for (const id of ['short', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64)]) {
  assert.equal((await request('/messages', {}, id)).status, 401)
}
assert.equal((await handle(new Request('http://relay/messages'))).status, 401)
assert.equal((await handle(new Request('http://relay/elsewhere'))).status, 404)
assert.equal((await handle(new Request('http://relay/health'))).status, 200)

// An empty post is refused and stores nothing.
assert.equal((await post('')).status, 400)
assert.equal((await read()).length, 0)

// Posts come back in order, `after` skips what was read, and rooms stay apart.
const first = (await (await post('one')).json()).id
const second = (await (await post('two')).json()).id
assert.ok(second > first)
assert.ok(first > Date.now() - 60_000) // ids are timestamps, so a restart cannot rewind them past a cursor
assert.deepEqual(blobs(await read()), ['one', 'two'])
assert.deepEqual(blobs(await read(`?after=${first}`)), ['two'])
assert.equal((await read('', 'b'.repeat(64))).length, 0)

// A waiting poll wakes on a post, well before its timeout.
const started = Date.now()
const waiting = read(`?after=${second}&wait=5`)
await post('three')
assert.equal((await waiting)[0].data, 'three')
assert.ok(Date.now() - started < 1000)

// A poll with nothing new returns empty after its wait.
const quiet = 'c'.repeat(64)
const before = Date.now()
assert.equal((await read('?wait=1', quiet)).length, 0)
assert.ok(Date.now() - before >= 900)

// The log keeps only the newest 50.
for (let i = 0; i < 60; i++) await post(`bulk ${i}`)
const log = await read()
assert.equal(log.length, 50)
assert.equal(log.at(-1).data, 'bulk 59')

// Rooms past the cap evict the least recently used, sparing a room still in use.
const active = 'd'.repeat(64)
await post('keep', active)
for (let i = 0; i < 260; i++) {
  await post('x', String(i).padStart(64, '0'))
  if (i % 100 === 0) await read('', active)
}
assert.equal((await read('', active)).length, 1)
assert.equal((await read('', '0'.repeat(64))).length, 0)

// One address gets 120 requests a minute, and 20 new rooms an hour; others are not held back.
const busy = '203.0.113.7'
for (let i = 0; i < 120; i++) assert.equal((await request('/messages', {}, TOKEN, busy)).status, 200)
assert.equal((await request('/messages', {}, TOKEN, busy)).status, 429)
assert.equal((await request('/messages', {}, 'short', busy)).status, 429)
assert.equal((await request('/messages')).status, 200)

const maker = '203.0.113.8'
for (let i = 0; i < 20; i++) assert.equal((await request('/messages', {}, `f${String(i).padStart(63, '0')}`, maker)).status, 200)
assert.equal((await request('/messages', {}, 'e'.repeat(64), maker)).status, 429)
assert.equal((await request('/messages', {}, TOKEN, maker)).status, 200) // a room that exists is not a new one

// The body cap lives in the server, not in handle.
const server = Bun.serve({ ...options, port: 0 })
const big = { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: 'x'.repeat(20_000) }
assert.equal((await fetch(`${server.url}messages`, big)).status, 413)
// Chunked too, with no length up front: Bun before 1.3.14 let this past the cap.
const chunked = new ReadableStream({
  start(stream) {
    stream.enqueue(new TextEncoder().encode('x'.repeat(20_000)))
    stream.close()
  },
})
const streamed = await fetch(`${server.url}messages`, { ...big, body: chunked, duplex: 'half' } as RequestInit).catch(() => null)
assert.notEqual(streamed?.status, 200)
assert.ok((await read()).every(message => message.data.length < 20_000))
server.stop(true)

console.log('relay check passed')
