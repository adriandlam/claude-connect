export type Room = {
  relay: string
  /** The invite's secret: `id` and `key` both derive from it. */
  token: string
  /** Hex sha256 of `connect room:` + token: how the relay tells rooms apart. It cannot work back to `key`. */
  id: string
  /** The key messages are sealed with, in base64, also derived from the token. */
  key: string
  /** This clone's sender id, kept across restarts, so its own messages are skipped. */
  sid: string
  /** How you appear to teammates: the /config name, else git user.name, else $USER, cleaned and capped. */
  name: string
  root: string
  /** The project's normalized git remote; '' with none. */
  origin: string
}
export type Message = {
  /** The sending clone. */
  sid: string
  from: string
  kind: 'join' | 'msg' | 'request'
  summary: string
  /** The body; a join's is the sender's origin. */
  text: string
  /** The sender's branch and commit. */
  at: string
  /** Rising per sender, restarts included, so a replay can be told apart. */
  stamp: number
}
/** A message as the relay stores it: its id and the sealed blob in base64. */
export type Sealed = { id: number; data: string }

declare module 'claude-code' {
  interface PluginState {
    connect: { room: Room | null; footer: { text: string; who: string }; heard: boolean; unread: boolean }
  }
}
