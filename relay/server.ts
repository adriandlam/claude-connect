// The /connect relay: one in-memory mailbox per room. It holds sealed blobs and
// knows a room by a hash of its token, so it can read neither messages nor names.
// Runs on Bun: `bun relay/server.ts`.
//
// ponytail: in-memory, so a restart drops the backlog. Message ids are
// timestamps, so clients keep working across one. Add SQLite if history matters.
import type { Sealed } from '../types'

const MAX_ROOMS = 200
const MAX_LOG = 50
const MAX_BODY = 16_384 // bytes: the mod's MAX_TEXT and MAX_SUMMARY, sealed, with room for escapes
const MAX_WAIT_SECONDS = 25
// Per address. A session polls about 3 times a minute, and every 5 s while the relay is down.
const MAX_REQUESTS_PER_MINUTE = 120
const MAX_NEW_ROOMS_PER_HOUR = 20 // so one address cannot push everyone's rooms out
const MAX_TRACKED = 10_000

type Room = { log: Sealed[]; last: number; waiters: Set<() => void> }

type Usage = { minute: number; requests: number; hour: number; rooms: number }

const rooms = new Map<string, Room>()
const usage = new Map<string, Usage>()

function allows(address: string, isNewRoom: boolean) {
  const now = Date.now()
  const minute = Math.floor(now / 60_000)
  const hour = Math.floor(now / 3_600_000)
  // ponytail: forgets everyone at once, so 10,000 addresses can reset the counts. Prune by age if that matters.
  if (usage.size > MAX_TRACKED) usage.clear()
  const used = usage.get(address) ?? { minute, requests: 0, hour, rooms: 0 }
  if (used.minute !== minute) Object.assign(used, { minute, requests: 0 })
  if (used.hour !== hour) Object.assign(used, { hour, rooms: 0 })
  usage.set(address, used)
  return ++used.requests <= MAX_REQUESTS_PER_MINUTE && (!isNewRoom || ++used.rooms <= MAX_NEW_ROOMS_PER_HOUR)
}

function roomFor(id: string) {
  const room = rooms.get(id) ?? { log: [], last: 0, waiters: new Set() }
  rooms.delete(id)
  rooms.set(id, room)
  if (rooms.size > MAX_ROOMS) rooms.delete(rooms.keys().next().value!)
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
  // Railway's edge sets X-Real-IP; behind no proxy a client could, so there it falls to the socket.
  const address = req.headers.get('x-real-ip') ?? server?.requestIP(req)?.address ?? ''
  if (!allows(address, !!id && !rooms.has(id))) {
    return new Response('too many requests from this address', { status: 429, headers: { 'retry-after': '60' } })
  }
  if (!id) return new Response('needs a room id: 64 hex characters', { status: 401 })
  const room = roomFor(id)

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
  if (wait > 0 && room.last <= after) await waitForNews(room, wait)
  return Response.json({ messages: room.log.filter(message => message.id > after) })
}

export const options = {
  idleTimeout: MAX_WAIT_SECONDS + 15, // Bun's default of 10 s would cut every long poll
  maxRequestBodySize: MAX_BODY,
  fetch: handle,
}

if (import.meta.main) console.log(`relay on ${Bun.serve(options).url}`)
