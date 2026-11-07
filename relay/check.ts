// Self-check for the relay: `bun relay/check.ts`. Exits non-zero if the logic breaks.
import assert from 'node:assert/strict'

import { handle, options } from './server'

const TOKEN = 'a'.repeat(32)
const request = (path: string, init: RequestInit = {}, token = TOKEN) =>
  handle(new Request(`http://relay${path}`, { ...init, headers: { authorization: `Bearer ${token}` } }))
const post = (data: string, token = TOKEN) => request('/messages', { method: 'POST', body: data }, token)
const read = async (query = '', token = TOKEN) => (await (await request(`/messages${query}`, {}, token)).json()).messages
const blobs = (messages: { data: string }[]) => messages.map(message => message.data)

// A bad token is refused: a short one would be a guessable room.
assert.equal((await request('/messages', {}, 'short')).status, 401)
assert.equal((await request('/messages', {}, 'a'.repeat(129))).status, 401)
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
assert.equal((await read('', 'b'.repeat(32))).length, 0)

// A waiting poll wakes on a post, well before its timeout.
const started = Date.now()
const waiting = read(`?after=${second}&wait=5`)
await post('three')
assert.equal((await waiting)[0].data, 'three')
assert.ok(Date.now() - started < 1000)

// A poll with nothing new returns empty after its wait.
const quiet = 'c'.repeat(32)
const before = Date.now()
assert.equal((await read('?wait=1', quiet)).length, 0)
assert.ok(Date.now() - before >= 900)

// The log keeps only the newest 50.
for (let i = 0; i < 60; i++) await post(`bulk ${i}`)
const log = await read()
assert.equal(log.length, 50)
assert.equal(log.at(-1).data, 'bulk 59')

// Rooms past the cap evict the least recently used, sparing a room still in use.
const active = 'k'.repeat(32)
await post('keep', active)
for (let i = 0; i < 260; i++) {
  await post('x', `room-${String(i).padStart(30, '0')}`)
  if (i % 100 === 0) await read('', active)
}
assert.equal((await read('', active)).length, 1)
assert.equal((await read('', 'room-' + '0'.repeat(30))).length, 0)

// The body cap lives in the server, not in handle.
const server = Bun.serve({ ...options, port: 0 })
const big = { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: 'x'.repeat(20_000) }
assert.equal((await fetch(`${server.url}messages`, big)).status, 413)
server.stop(true)

console.log('relay check passed')
