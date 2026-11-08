export type Room = { relay: string; token: string; id: string; key: string; sid: string; name: string; root: string; origin: string }
export type Message = { sid: string; from: string; kind: 'join' | 'msg' | 'request'; summary: string; text: string; at: string; stamp: number }
export type Sealed = { id: number; data: string }

declare module 'claude-code' {
  interface PluginState {
    connect: { room: Room | null; footer: { text: string; who: string }; heard: boolean; unread: boolean }
  }
}
