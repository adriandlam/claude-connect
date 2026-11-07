export type Room = { relay: string; token: string; id: string; key: string; sid: string; name: string; root: string }
export type Message = { id: number; sid: string; from: string; kind: string; summary: string; text: string; stamp: number }
export type Sealed = { id: number; data: string }

declare module 'claude-code' {
  interface PluginState {
    connect: { room: Room | null; footer: string }
  }
}
