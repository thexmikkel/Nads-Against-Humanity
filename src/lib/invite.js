// src/lib/invite.js
import { keccak256, toUtf8Bytes } from 'ethers'

// 6-char code, avoid O/0, I/1
export function randomInvite() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const arr = new Uint8Array(6)
  crypto.getRandomValues(arr)
  let s = ''
  for (let i = 0; i < 6; i++) s += alphabet[arr[i] % alphabet.length]
  return s
}

// Hash the uppercase code – no Buffer needed
export function inviteHash(code) {
  const normalized = (code || '').trim().toUpperCase()
  return keccak256(toUtf8Bytes(normalized))
}
