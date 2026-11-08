// The /connect relay: one mailbox per room, kept in SQLite. It holds sealed blobs and
// knows a room by a hash of its token, so it can read neither messages nor names.
import { Database } from 'bun:sqlite'
import { timingSafeEqual } from 'node:crypto'
import type { Sealed } from '../types'

/** Rooms the relay holds. Full, with DB_PATH a file, it measured 134 MB RSS; in memory about 400 MB. */
const MAX_ROOMS = 400
/** A session polls every 25 s, so a room quiet this long has nobody in it. */
const IDLE_MS = 2 * 60_000
const MAX_LOG = 50
/** Bytes: the mod's MAX_TEXT and MAX_SUMMARY, sealed and in base64. */
const MAX_BODY = 12_288
/** Bytes of message data in one reply; the client pages with `after`. */
const MAX_PAGE = 65_536
const MAX_WAIT_SECONDS = 25
/**
 * Per address. A session polls about 3 times a minute, and every 5 s while the relay is down; one office,
 * campus or carrier NAT can be many people behind one address.
 */
const MAX_REQUESTS_PER_MINUTE = 300
/** Per address. */
const MAX_NEW_ROOMS_PER_HOUR = 60
/** Rooms in use per address, so a few addresses cannot hold every room. */
const MAX_LIVE_ROOMS = 5
/**
 * The same per IPv6 /48, so one host cannot take a /64 per room. Larger, since a carrier gives each phone its
 * own /64 out of a /48 many people share; small enough that filling the relay takes 40 of them. RELAY_SECRET
 * keeps strangers out entirely.
 */
const MAX_LIVE_ROOMS_PER_BLOCK = 10
const MAX_TRACKED_ADDRESSES = 10_000
/**
 * The header holding the client's address. Railway's edge overwrites X-Real-IP (a forged one still hit the
 * limit), so it is trusted there; elsewhere a client could forge any header, so set IP_HEADER to the one your
 * proxy sets. Of a list such as X-Forwarded-For only the last entry is the proxy's own.
 */
const IP_HEADER = process.env.RAILWAY_ENVIRONMENT_ID ? 'x-real-ip' : process.env.IP_HEADER
/** With a secret, the relay's URL is https://host/<secret>, and only those who hold it can make rooms. */
const SECRET = process.env.RELAY_SECRET
const ROUTE = SECRET ? `/${SECRET}/messages` : '/messages'
/** The relay's URL itself, so opening it in a browser shows it works. */
const HOME = SECRET ? `/${SECRET}` : '/'
/** Base64 only, so a body's length is its size in bytes, never text the runtime would hold as UTF-16. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * The address the limits count: one IPv6 host holds a whole /64, and a home line can hold a /48, 65,536 of
 * those.
 * @param groups IPv6 groups kept: 4 for the /64, 3 for the /48 that rooms in use are also counted per.
 */
export function clientOf(address: string, groups = 4) {
  const ip = address.split(',').at(-1)!.trim().toLowerCase().replace(/%.*/, '')
  if (!ip.includes(':') || ip.startsWith('::ffff:')) return ip
  const [head = '', tail] = ip.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const missing = Math.max(0, 8 - left.length - right.length)
  const parts = tail === undefined ? left : [...left, ...Array(missing).fill('0'), ...right]
  return `${parts.slice(0, groups).map(part => parseInt(part, 16).toString(16)).join(':')}::/${groups * 16}`
}

type Room = {
  /** The newest message id: a timestamp never below the one before, stored so a restart cannot rewind it past a client's cursor. */
  last: number
  /** The newest id dropped from the log; at first, when the room was made. */
  pruned: number
  /** When it was last used, in ms. */
  seen: number
  /** The address that made it, for MAX_LIVE_ROOMS. */
  creator: string
  /** The /48 that made it, for MAX_LIVE_ROOMS_PER_BLOCK. */
  block: string
  waiters: Set<() => void>
}

type Usage = { minute: number; requests: number; hour: number; newRooms: number }

const db = new Database(process.env.DB_PATH || ':memory:')
db.run('pragma journal_mode = wal')
// With WAL, a power cut can lose the last posts but not corrupt the file; every poll writes, so this skips an fsync each.
db.run('pragma synchronous = normal')
db.run('create table if not exists rooms (id text primary key, last integer, pruned integer, seen integer)')
db.run('create table if not exists messages (room text, id integer, data text, primary key (room, id)) without rowid')
const saveRoom = db.prepare('insert or replace into rooms (id, last, pruned, seen) values (?, ?, ?, ?)')
const dropRoom = db.prepare('delete from rooms where id = ?')
const dropLog = db.prepare('delete from messages where room = ?')
const addMessage = db.prepare('insert into messages values (?, ?, ?)')
const prune = db.prepare<{ id: number }, [string, string, number]>(
  'delete from messages where room = ? and id <= (select id from messages where room = ? order by id desc limit 1 offset ?) returning id',
)
const readLog = db.prepare<Sealed, [string, number, number]>('select id, data from messages where room = ? and id > ? order by id limit ?')

/**
 * Kept in the order they were last used, as eviction needs. Waiters and who made a room
 * live only in memory, so no address is kept on disk; a room loaded here counts for no one.
 */
const rooms = new Map<string, Room>()
const storedRooms = db.query<Pick<Room, 'last' | 'pruned' | 'seen'> & { id: string }, []>('select id, last, pruned, seen from rooms order by seen').all()
for (const { id, ...room } of storedRooms) rooms.set(id, { ...room, creator: '', block: '', waiters: new Set() })
const usage = new Map<string, Usage>()
const save = (id: string, { last, pruned, seen }: Room) => saveRoom.run(id, last, pruned, seen)
const liveRoomsOf = (key: 'creator' | 'block', value: string, since: number) =>
  [...rooms.values()].filter(room => room[key] === value && room.seen > since).length

/** Counts a request against its address's limits; false once one is over. */
function allows(address: string, isNewRoom: boolean) {
  const now = Date.now()
  const minute = Math.floor(now / 60_000)
  const hour = Math.floor(now / 3_600_000)
  if (usage.size > MAX_TRACKED_ADDRESSES) for (const [key, used] of usage) if (used.hour !== hour) usage.delete(key)
  // ponytail: 10,000 addresses within one hour reset everyone's counts. A botnet is past this relay anyway.
  if (usage.size > MAX_TRACKED_ADDRESSES) usage.clear()
  const used = usage.get(address) ?? { minute, requests: 0, hour, newRooms: 0 }
  if (used.minute !== minute) Object.assign(used, { minute, requests: 0 })
  if (used.hour !== hour) Object.assign(used, { hour, newRooms: 0 })
  usage.set(address, used)
  if (++used.requests > MAX_REQUESTS_PER_MINUTE) return false
  return !isNewRoom || ++used.newRooms <= MAX_NEW_ROOMS_PER_HOUR
}

const evict = db.transaction((id: string) => {
  dropRoom.run(id)
  dropLog.run(id)
})

/**
 * The room, made if new and marked used. A new room takes the place of one nobody has used for IDLE_MS, never
 * of one in use: null when every room is busy and the relay is full.
 */
function roomFor(id: string, creator: string, block: string) {
  const now = Date.now()
  let room = rooms.get(id)
  if (!room) {
    if (rooms.size >= MAX_ROOMS) {
      const [oldestId, oldest] = rooms.entries().next().value ?? []
      if (!oldest || oldest.waiters.size || now - oldest.seen < IDLE_MS) return null
      rooms.delete(oldestId!)
      evict(oldestId!)
    }
    // Its ids start at now and every cursor from a log it lost is older, so a reader of that log hears of the gap.
    room = { last: 0, pruned: now, seen: now, creator, block, waiters: new Set() }
  }
  rooms.delete(id)
  rooms.set(id, room)
  room.seen = now
  save(id, room)
  return room
}

/** Logs a message under an id never below the room's last, then prunes the log to MAX_LOG. */
const append = db.transaction((id: string, room: Room, data: string) => {
  room.last = Math.max(room.last + 1, Date.now())
  addMessage.run(id, room.last, data)
  for (const { id: gone } of prune.all(id, id, MAX_LOG)) room.pruned = Math.max(room.pruned, gone)
  save(id, room)
})

/** Messages after `after`, up to MAX_PAGE bytes but always at least one; `more` when MAX_PAGE cut it short. */
function page(id: string, after: number) {
  const messages: Sealed[] = []
  let size = 0
  for (const message of readLog.all(id, after, MAX_LOG + 1)) {
    if (messages.length && size + message.data.length > MAX_PAGE) return { messages, more: true }
    size += message.data.length
    messages.push(message)
  }
  return { messages, more: false }
}

function waitForNews(room: Room, seconds: number) {
  const { promise, resolve } = Promise.withResolvers<void>()
  const timer = setTimeout(resolve, seconds * 1000)
  room.waiters.add(resolve)
  return promise.finally(() => {
    clearTimeout(timer)
    room.waiters.delete(resolve)
  })
}

const digest = (text: string) => new Bun.CryptoHasher('sha256').update(text).digest()
/** Compares hashes, as timingSafeEqual needs equal lengths, so the secret in a path cannot be guessed by timing. */
const isPath = (path: string, expected: string) => timingSafeEqual(digest(path), digest(expected))

export async function handle(req: Request, server?: Bun.Server<undefined>) {
  const url = new URL(req.url)
  if (url.pathname === '/health') return new Response('ok') // the host's healthcheck, so a deploy swaps in only once it answers
  if (req.method === 'GET' && isPath(url.pathname, HOME)) return new Response('claude-connect relay is up. Paste this URL into /connect in Claude Code.')
  if (!isPath(url.pathname, ROUTE)) return new Response('not found', { status: 404 })

  const id = req.headers.get('authorization')?.match(/^Bearer ([0-9a-f]{64})$/)?.[1]
  const ip = (IP_HEADER && req.headers.get(IP_HEADER)) || server?.requestIP(req)?.address || ''
  const address = clientOf(ip)
  const block = clientOf(ip, 3)
  const isNewRoom = !!id && !rooms.has(id)
  const since = Date.now() - IDLE_MS
  const isCrowded =
    isNewRoom && (liveRoomsOf('creator', address, since) >= MAX_LIVE_ROOMS || liveRoomsOf('block', block, since) >= MAX_LIVE_ROOMS_PER_BLOCK)
  if (!allows(address, isNewRoom) || isCrowded) {
    return new Response('too many requests from this address', { status: 429, headers: { 'retry-after': '60' } })
  }
  if (!id) return new Response('needs a room id: 64 hex characters', { status: 401 })
  const room = roomFor(id, address, block)
  if (!room) return new Response('relay full, try again in a few minutes', { status: 503, headers: { 'retry-after': '120' } })

  if (req.method === 'POST') {
    const data = await req.text().catch(() => '')
    if (data.length > MAX_BODY || !BASE64.test(data)) return new Response(`needs a base64 body of at most ${MAX_BODY} bytes`, { status: 400 })
    // Evicted while its body came in: writing now would bring back a room the relay no longer tracks.
    if (rooms.get(id) !== room) return new Response('relay full, try again in a few minutes', { status: 503, headers: { 'retry-after': '120' } })
    append(id, room, data)
    for (const wake of room.waiters) wake()
    return Response.json({ id: room.last })
  }

  const cursor = Number(url.searchParams.get('after')) || 0
  // The relay lost or reset this room's log, so it sends what it has and says the rest is gone.
  const isLost = cursor > room.last
  const after = isLost ? 0 : cursor
  const wait = Math.min(Number(url.searchParams.get('wait')) || 0, MAX_WAIT_SECONDS)
  // A room with waiters is never evicted, so it is still this one after the wait.
  if (wait > 0 && room.last <= after) await waitForNews(room, wait)
  return Response.json({ ...page(id, after), pruned: isLost ? Number.MAX_SAFE_INTEGER : room.pruned })
}

export const options = {
  /** Bun's default of 10 s would cut every long poll. */
  idleTimeout: MAX_WAIT_SECONDS + 15,
  maxRequestBodySize: MAX_BODY,
  fetch: handle,
}

if (import.meta.main) {
  if (!SECRET) console.warn('RELAY_SECRET is unset: anyone who can reach this relay can make rooms on it')
  if (!IP_HEADER) console.warn('IP_HEADER is unset: behind a proxy, every client counts as the proxy for rate limits')
  const server = Bun.serve(options)
  // A redeploy: answer every waiting poll now, so clients poll the new relay instead of timing out.
  process.on('SIGTERM', async () => {
    for (const room of rooms.values()) for (const wake of room.waiters) wake()
    await server.stop()
    db.close()
    process.exit(0)
  })
  // Last, as the line that says it is ready: a SIGTERM from here on is handled.
  console.log(`relay on ${server.url}`)
  // Not the secret itself: deploy logs get pasted into issues and forwarded by log drains.
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN
  if (SECRET && domain) console.log(`Ready. In Claude Code run: /connect https://${domain}/<RELAY_SECRET from Variables>`)
  else if (SECRET && process.env.RAILWAY_ENVIRONMENT_ID) console.log('No public domain yet: run `railway domain` or add one under Settings > Networking, then redeploy for your /connect line.')
}
