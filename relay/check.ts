// Self-check for the relay: `bun relay/check.ts`. Exits non-zero if the logic breaks.
import assert from 'node:assert/strict'

process.env.IP_HEADER = 'x-real-ip' // as behind a proxy that sets it
const { handle, options, clientOf } = await import('./server')

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

// The relay's clock, moved forward to make rooms idle.
let skew = 0
const realNow = Date.now
Date.now = () => realNow() + skew
const idle = () => (skew += 3 * 60_000)

// Full of rooms in use, the relay refuses a new one rather than drop one.
const active = 'd'.repeat(64)
await post('keep', active)
const room = (prefix: string, i: number) => `${prefix}${String(i).padStart(63, '0')}`
let made = 0
while (made < 1000 && (await post('x', room('1', made))).status === 200) made++
assert.ok(made > 390)
const full = await post('x', room('1', made))
assert.equal(full.status, 503)
assert.equal(full.headers.get('retry-after'), '120')

// Once rooms go idle, a new room takes the place of the one unused longest, never of one in use.
idle()
await read('', active)
for (let i = 0; i < 50; i++) assert.equal((await post('x', room('2', i))).status, 200)
assert.equal((await read('', active)).length, 1)
assert.equal((await read('', room('1', 0))).length, 0)

// A room being long-polled is in use, however long its poll waits.
const polled = '9'.repeat(64)
await post('held', polled)
const polling = read('?after=99999999999999&wait=1', polled)
idle()
for (let i = 0; i < 450; i++) await post('x', room('3', i))
await polling
assert.equal((await read('', polled)).length, 1)
idle()

// IPv6 counts by /64, and only a forwarded list's last entry is the proxy's.
assert.equal(clientOf('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64')
assert.equal(clientOf('2001:DB8:1:2:bbbb:cccc:dddd:eeee'), '2001:db8:1:2::/64')
assert.equal(clientOf('2001:db8::5'), '2001:db8:0:0::/64')
assert.equal(clientOf('fe80::1%en0'), 'fe80:0:0:0::/64')
assert.equal(clientOf('::1'), '0:0:0:0::/64')
assert.equal(clientOf('203.0.113.9'), '203.0.113.9')
assert.equal(clientOf('::ffff:203.0.113.9'), '::ffff:203.0.113.9')
assert.equal(clientOf('6.6.6.6, 203.0.113.9'), '203.0.113.9')

// One address gets 300 requests a minute, and 60 new rooms an hour; others are not held back.
const busy = '203.0.113.7'
for (let i = 0; i < 300; i++) assert.equal((await request('/messages', {}, TOKEN, busy)).status, 200)
assert.equal((await request('/messages', {}, TOKEN, busy)).status, 429)
assert.equal((await request('/messages', {}, 'short', busy)).status, 429)
assert.equal((await request('/messages')).status, 200)
const host = (i: number) => `2001:db8:0:7::${i.toString(16)}`
for (let i = 0; i < 300; i++) await request('/messages', {}, TOKEN, host(i))
assert.equal((await request('/messages', {}, TOKEN, host(999))).status, 429)

const maker = '203.0.113.8'
for (let i = 0; i < 60; i++) assert.equal((await request('/messages', {}, `f${String(i).padStart(63, '0')}`, maker)).status, 200)
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
