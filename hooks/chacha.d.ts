type Cipher = { encrypt(plain: Uint8Array): Uint8Array; decrypt(sealed: Uint8Array): Uint8Array }

export const xchacha20poly1305: (key: Uint8Array, nonce: Uint8Array) => Cipher
export function managedNonce(make: typeof xchacha20poly1305): (key: Uint8Array) => Cipher

// In the mod's runtime, and in Bun, but not yet in TypeScript's es2023 lib.
declare global {
  interface Uint8Array {
    toBase64(): string
    toHex(): string
  }
  interface Uint8ArrayConstructor {
    fromBase64(text: string): Uint8Array<ArrayBuffer>
  }
}
