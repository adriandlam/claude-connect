// Self-check for the relay: `bun relay/check.ts`. Exits non-zero if the logic breaks.
import assert from 'node:assert/strict'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.IP_HEADER = 'x-real-ip' // as behind a proxy that sets it
delete process.env.RELAY_SECRET
delete process.env.DB_PATH
const { handle, options, clientOf } = await import('./server')

const TOKEN = 'a'.repeat(64)
let caller = 0 // each request from its own address, unless a check names one
const request = (path: string, init: RequestInit = {}, token = TOKEN, address = `10.0.0.${++caller}`) =>
  handle(new Request(`http://relay${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'x-real-ip': address } }))
const post = (data: string, token = TOKEN) => request('/messages', { method: 'POST', body: data }, token)
const page = async (query = '', token = TOKEN) => await (await request(`/messages${query}`, {}, token)).json()
const read = async (query = '', token = TOKEN) => (await page(query, token)).messages
const idOf = async (reply: Response | Promise<Response>) => (await (await reply).json()).id as number
const blobs = (messages: { data: string }[]) => messages.map(message => message.data)

// Only a room id is taken: the hash the mod sends, never a guessable name.
for (const id of ['short', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64)]) {
  assert.equal((await request('/messages', {}, id)).status, 401)
}
assert.equal((await handle(new Request('http://relay/messages'))).status, 401)
assert.equal((await handle(new Request('http://relay/elsewhere'))).status, 404)
assert.equal((await handle(new Request('http://relay/health'))).status, 200)

// A post that is empty, not base64 or over 12,288 bytes is refused and stores nothing.
for (const body of ['', 'not base64!', 'a b', '=abc', 'abc===', 'é', 'A'.repeat(12_289)]) assert.equal((await post(body)).status, 400)
assert.equal((await read()).length, 0)

// Posts come back in order, `after` skips what was read, and rooms stay apart.
const first = await idOf(post('one'))
const second = await idOf(post('two'))
assert.ok(second > first)
assert.ok(first > Date.now() - 60_000) // ids are timestamps, so a restart cannot rewind them past a cursor
assert.deepEqual(blobs(await read()), ['one', 'two'])
assert.deepEqual(blobs(await read(`?after=${first}`)), ['two'])
assert.equal((await read('', 'b'.repeat(64))).length, 0)
// A cursor past the room's last id means the relay lost its log, so the reply starts over and says so.
const restarted = await page(`?after=${second + 1_000_000}`)
assert.deepEqual(blobs(restarted.messages), ['one', 'two'])
assert.ok(restarted.pruned > second + 1_000_000)
const caughtUp = await page(`?after=${first}`)
assert.deepEqual(caughtUp.messages, [{ id: second, data: 'two' }])
assert.ok(caughtUp.pruned <= first) // a new room's `pruned` is when it was made, before any of its ids

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

// The log keeps only the newest 50, and says the newest id it dropped.
const bulk = '5'.repeat(64)
const bulkIds: number[] = []
for (let i = 0; i < 60; i++) bulkIds.push(await idOf(post(`bulk${i}`, bulk)))
const log = await page('', bulk)
assert.equal(log.messages.length, 50)
assert.equal(log.messages[0].data, 'bulk10')
assert.equal(log.messages.at(-1).data, 'bulk59')
assert.equal(log.pruned, bulkIds[9])

// A reply holds at most 64 KB of messages, at least one, and says when more remain.
const heavy = '6'.repeat(64)
for (let i = 0; i < 6; i++) assert.equal((await post('A'.repeat(12_288), heavy)).status, 200)
const firstPage = await page('', heavy)
assert.equal(firstPage.messages.length, 5)
assert.equal(firstPage.more, true)
const lastPage = await page(`?after=${firstPage.messages.at(-1).id}&wait=5`, heavy)
assert.equal(lastPage.messages.length, 1)
assert.equal(lastPage.more, false)

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
const filled = Date.now() // past every id in those rooms
const full = await post('x', room('1', made))
assert.equal(full.status, 503)
assert.equal(full.headers.get('retry-after'), '120')

// Once rooms go idle, a new room takes the place of the one unused longest, never of one in use.
idle()
await read('', active)
for (let i = 0; i < 50; i++) assert.equal((await post('x', room('2', i))).status, 200)
assert.equal((await read('', active)).length, 1)
// A reader whose room was evicted is told its unread messages are gone.
const evicted = await page('?after=1', room('1', 0))
assert.equal(evicted.messages.length, 0)
assert.ok(evicted.pruned > 1)
// So is one whose evicted room was made again by a post, though its cursor is older than every new id.
await post('again', room('1', 1))
const remade = await page(`?after=${filled}`, room('1', 1))
assert.deepEqual(blobs(remade.messages), ['again'])
assert.ok(remade.pruned > filled)

// A room being long-polled is in use, however long its poll waits.
const polled = '9'.repeat(64)
const held = await idOf(post('held', polled))
const polling = read(`?after=${held}&wait=1`, polled)
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
assert.equal(clientOf('1:2:3:4:5:6:7:8:9::a'), '1:2:3:4::/64') // malformed, but must not throw
assert.equal(clientOf('2001:db8:1:2:aaaa::1', 3), '2001:db8:1::/48')
assert.equal(clientOf('203.0.113.9', 3), '203.0.113.9')

// One address gets 300 requests a minute, and 60 new rooms an hour; others are not held back.
const busy = '203.0.113.7'
for (let i = 0; i < 300; i++) assert.equal((await request('/messages', {}, TOKEN, busy)).status, 200)
assert.equal((await request('/messages', {}, TOKEN, busy)).status, 429)
assert.equal((await request('/messages', {}, 'short', busy)).status, 429)
assert.equal((await request('/messages')).status, 200)
const host = (i: number) => `2001:db8:0:7::${i.toString(16)}`
for (let i = 0; i < 300; i++) await request('/messages', {}, TOKEN, host(i))
assert.equal((await request('/messages', {}, TOKEN, host(999))).status, 429)

// A minute into a fresh hour, so the hourly count starts at zero and stays in one hour.
skew += 3_600_000 - (Date.now() % 3_600_000) + 60_000
// One address keeps at most 5 rooms in use; rooms it stopped using no longer count.
const squatter = '203.0.113.6'
for (let i = 0; i < 5; i++) assert.equal((await request('/messages', {}, room('7', i), squatter)).status, 200)
assert.equal((await request('/messages', {}, room('7', 5), squatter)).status, 429)
assert.equal((await request('/messages', {}, room('7', 0), squatter)).status, 200) // a room that exists is not a new one
idle()
assert.equal((await request('/messages', {}, room('7', 5), squatter)).status, 200)
// For IPv6 the address is a /64, and a /48 holds at most 10: a carrier's phones each get a /64
// out of a shared /48, so one of them filling its own 5 leaves room for the rest.
const phone = (i: number) => `2001:db8:5:${i.toString(16)}::1`
for (let i = 0; i < 5; i++) assert.equal((await request('/messages', {}, room('8', i), phone(0))).status, 200)
assert.equal((await request('/messages', {}, room('8', 5), phone(0))).status, 429)
for (let i = 5; i < 10; i++) assert.equal((await request('/messages', {}, room('8', i), phone(1))).status, 200)
assert.equal((await request('/messages', {}, room('8', 10), phone(2))).status, 429)
assert.equal((await request('/messages', {}, room('8', 11), '2001:db8:6::1')).status, 200)
idle()

const maker = '203.0.113.8'
for (let i = 0; i < 60; i++) {
  if (i % 5 === 0) idle()
  assert.equal((await request('/messages', {}, room('f', i), maker)).status, 200)
}
idle()
assert.equal((await request('/messages', {}, 'e'.repeat(64), maker)).status, 429)
assert.equal((await request('/messages', {}, TOKEN, maker)).status, 200)

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

// The relay as deployed: its own process, a secret path and a database file.
const dir = mkdtempSync(join(tmpdir(), 'relay-'))
const DB_PATH = join(dir, 'relay.db')
async function start(env: Record<string, string>) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, 'server.ts')], {
    env: { ...process.env, PORT: '0', DB_PATH, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const lines = child.stdout.getReader()
  let out = ''
  while (!out.includes('\n')) {
    const { value, done } = await lines.read()
    if (done) throw new Error(`relay exited before it started: ${await new Response(child.stderr).text()}`)
    out += new TextDecoder().decode(value)
  }
  const base = out.match(/relay on (\S+?)\/?\s/)![1]
  const call = (path: string, init: RequestInit = {}, token = TOKEN) => fetch(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${token}` } })
  const stop = async () => {
    child.kill('SIGTERM')
    assert.equal(await child.exited, 0)
    return await new Response(child.stderr).text()
  }
  return { call, stop }
}

const secret = await start({ RELAY_SECRET: 'b9f1c2' })
assert.equal((await secret.call('/messages')).status, 404)
assert.equal((await secret.call('/b9f1c3/messages')).status, 404)
assert.equal((await secret.call('/b9f1c2/messages/x')).status, 404)
assert.equal((await secret.call('/health')).status, 200)
const kept: number[] = []
for (let i = 0; i < 55; i++) kept.push(await idOf(secret.call('/b9f1c2/messages', { method: 'POST', body: `kept${i}` })))
// Stopping answers a waiting poll at once, so its client polls the next relay.
const asleep = performance.now()
const parked = secret.call(`/b9f1c2/messages?after=${kept.at(-1)}&wait=25`)
await Bun.sleep(500) // for the poll to reach the relay and wait there
const stopped = secret.stop()
assert.equal((await parked).status, 200)
assert.ok(performance.now() - asleep < 2000)
assert.doesNotMatch(await stopped, /RELAY_SECRET/)

// A restart keeps the log, `last` and `pruned`, so ids never go back, even on a slower clock.
// It keeps no address: the room's row holds only its id and where its log stands.
const file = new Database(DB_PATH)
assert.deepEqual(Object.keys(file.query('select * from rooms').get()!), ['id', 'last', 'pruned', 'seen'])
const ahead = realNow() + 1e9
file.run('update rooms set last = ?', [ahead])
// Full again, with the one idle room sorting last by id, so only the order it was used in finds it.
for (let i = 0; i < 398; i++) file.run('insert into rooms values (?, 0, 0, ?)', [room('f', i), realNow()])
file.run('insert into rooms values (?, 0, 0, 0)', ['0'.repeat(64)])
file.close()
const open = await start({ IP_HEADER: '' })
const restored = await (await open.call('/messages')).json()
assert.deepEqual(blobs(restored.messages), kept.slice(5).map((_, i) => `kept${i + 5}`))
assert.equal(restored.pruned, kept[4])
assert.equal((await open.call('/messages', {}, 'e'.repeat(64))).status, 200) // takes the idle room's place
assert.equal(await idOf(open.call('/messages', { method: 'POST', body: 'next' })), ahead + 1)
const warnings = await open.stop()
assert.match(warnings, /RELAY_SECRET is unset/)
assert.match(warnings, /IP_HEADER is unset/)
// A post's own write survives a stop with no request after it.
const again = await start({})
assert.deepEqual(await (await again.call(`/messages?after=${ahead + 1}`)).json(), { messages: [], more: false, pruned: kept[5] })
await again.stop()
rmSync(dir, { recursive: true })

console.log('relay check passed')
