// The /connect relay: one in-memory mailbox per room. It holds sealed blobs and
// knows a room by a hash of its token, so it can read neither messages nor names.
//
// ponytail: in-memory, so a restart drops the backlog. Message ids are
// timestamps, so clients keep working across one. Add SQLite if history matters.
import type { Sealed } from '../types'

const MAX_ROOMS = 400 // a full room holds up to 800 KB, so this stays inside 500 MB
const IDLE_MS = 2 * 60_000 // a session polls every 25 s, so a room quiet this long has nobody in it
const MAX_LOG = 50
const MAX_BODY = 16_384 // bytes: the mod's MAX_TEXT and MAX_SUMMARY, sealed, with room for escapes
const MAX_WAIT_SECONDS = 25
// Per address. A session polls about 3 times a minute, and every 5 s while the relay is down.
// One office, campus or carrier NAT can be many people behind one address.
const MAX_REQUESTS_PER_MINUTE = 300
const MAX_NEW_ROOMS_PER_HOUR = 60 // so one address cannot take every room
const MAX_TRACKED = 10_000
// Railway's edge overwrites X-Real-IP (a forged one still hit the limit), so it is trusted
// there. Elsewhere a client could forge any header: set IP_HEADER to the one your proxy sets.
// Of a list such as X-Forwarded-For only the last entry is the proxy's own.
const IP_HEADER = process.env.RAILWAY_ENVIRONMENT_ID ? 'x-real-ip' : process.env.IP_HEADER

// One IPv6 host holds a whole /64, so that is what the limits count.
export function clientOf(address: string) {
  const ip = address.split(',').at(-1)!.trim().toLowerCase().replace(/%.*/, '')
  if (!ip.includes(':') || ip.startsWith('::ffff:')) return ip
  const [head = '', tail] = ip.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const parts = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
  return `${parts.slice(0, 4).map(part => parseInt(part, 16).toString(16)).join(':')}::/64`
}

type Room = { log: Sealed[]; last: number; waiters: Set<() => void>; seen: number }

type Usage = { minute: number; requests: number; hour: number; rooms: number }

const rooms = new Map<string, Room>()
const usage = new Map<string, Usage>()

function allows(address: string, isNewRoom: boolean) {
  const now = Date.now()
  const minute = Math.floor(now / 60_000)
  const hour = Math.floor(now / 3_600_000)
  if (usage.size > MAX_TRACKED) for (const [key, used] of usage) if (used.hour !== hour) usage.delete(key)
  // ponytail: 10,000 addresses within one hour reset everyone's counts. A botnet is past this relay anyway.
  if (usage.size > MAX_TRACKED) usage.clear()
  const used = usage.get(address) ?? { minute, requests: 0, hour, rooms: 0 }
  if (used.minute !== minute) Object.assign(used, { minute, requests: 0 })
  if (used.hour !== hour) Object.assign(used, { hour, rooms: 0 })
  usage.set(address, used)
  return ++used.requests <= MAX_REQUESTS_PER_MINUTE && (!isNewRoom || ++used.rooms <= MAX_NEW_ROOMS_PER_HOUR)
}

// Rooms are kept in the order they were last used. A new room takes the place of one
// nobody has used for IDLE_MS, never of one in use: when every room is busy the relay is full.
function roomFor(id: string) {
  const now = Date.now()
  let room = rooms.get(id)
  if (!room) {
    const [oldest, old] = rooms.entries().next().value ?? []
    if (rooms.size >= MAX_ROOMS) {
      if (!old || old.waiters.size || now - old.seen < IDLE_MS) return null
      rooms.delete(oldest!)
    }
    room = { log: [], last: 0, waiters: new Set(), seen: now }
  }
  rooms.delete(id)
  rooms.set(id, room)
  room.seen = now
  return room
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

export async function handle(req: Request, server?: Bun.Server<undefined>) {
  const url = new URL(req.url)
  if (url.pathname === '/health') return new Response('ok') // the host's healthcheck, so a deploy swaps in only once it answers
  if (url.pathname !== '/messages') return new Response('not found', { status: 404 })

  const id = req.headers.get('authorization')?.match(/^Bearer ([0-9a-f]{64})$/)?.[1]
  const address = clientOf((IP_HEADER && req.headers.get(IP_HEADER)) || server?.requestIP(req)?.address || '')
  if (!allows(address, !!id && !rooms.has(id))) {
    return new Response('too many requests from this address', { status: 429, headers: { 'retry-after': '60' } })
  }
  if (!id) return new Response('needs a room id: 64 hex characters', { status: 401 })
  const room = roomFor(id)
  if (!room) return new Response('relay full, try again in a few minutes', { status: 503, headers: { 'retry-after': '120' } })

  if (req.method === 'POST') {
    const data = await req.text().catch(() => '')
    if (!data) return new Response('needs a body', { status: 400 })
    const message = { id: (room.last = Math.max(room.last + 1, Date.now())), data }
    room.log.push(message)
    if (room.log.length > MAX_LOG) room.log.shift()
    for (const wake of room.waiters) wake()
    return Response.json({ id: message.id })
  }

  const after = Number(url.searchParams.get('after')) || 0
  const wait = Math.min(Number(url.searchParams.get('wait')) || 0, MAX_WAIT_SECONDS)
  if (wait > 0 && room.last <= after) {
    await waitForNews(room, wait)
    if (rooms.get(id) === room) roomFor(id) // in use the whole time it waited
  }
  return Response.json({ messages: room.log.filter(message => message.id > after) })
}

export const options = {
  idleTimeout: MAX_WAIT_SECONDS + 15, // Bun's default of 10 s would cut every long poll
  maxRequestBodySize: MAX_BODY,
  fetch: handle,
}

if (import.meta.main) console.log(`relay on ${Bun.serve(options).url}`)
