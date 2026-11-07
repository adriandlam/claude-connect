// The /connect relay: one in-memory mailbox per room. It holds sealed blobs and
// knows a room by a hash of its token, so it can read neither messages nor names.
// Runs on Bun: `bun relay/server.ts`.
//
// ponytail: in-memory, so a restart drops the backlog. Message ids are
// timestamps, so clients keep working across one. Add SQLite if history matters.
import type { Sealed } from '../types'

const MAX_ROOMS = 200
const MAX_LOG = 50
const MAX_BODY = 16_384 // bytes: the mod's MAX_TEXT of 2,000 characters, sealed, with room for escapes
const MAX_WAIT_SECONDS = 25

type Room = { log: Sealed[]; last: number; waiters: Set<() => void> }

const rooms = new Map<string, Room>()

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

export async function handle(req: Request) {
  const url = new URL(req.url)
  if (url.pathname === '/health') return new Response('ok') // Railway waits on this before it swaps a deploy in
  if (url.pathname !== '/messages') return new Response('not found', { status: 404 })

  const id = req.headers.get('authorization')?.match(/^Bearer ([\w-]{32,128})$/)?.[1]
  if (!id) return new Response('needs a bearer token of 32 to 128 characters', { status: 401 })
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

  if (req.method === 'GET') {
    const after = Number(url.searchParams.get('after')) || 0
    const wait = Math.min(Number(url.searchParams.get('wait')) || 0, MAX_WAIT_SECONDS)
    if (wait > 0 && room.last <= after) await waitForNews(room, wait)
    return Response.json({ messages: room.log.filter(message => message.id > after) })
  }

  return new Response('method not allowed', { status: 405 })
}

export const options = {
  idleTimeout: MAX_WAIT_SECONDS + 15, // Bun's default of 10 s would cut every long poll
  maxRequestBodySize: MAX_BODY,
  fetch: handle,
}

if (import.meta.main) console.log(`relay on ${Bun.serve(options).url}`)
