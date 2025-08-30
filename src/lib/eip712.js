// src/lib/eip712.js
import { ethers } from 'ethers'

export const DOMAIN_NAME = 'MonadCAH'
export const DOMAIN_VERSION = '1'

export function buildDomain(chainId, verifyingContract) {
  return {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: Number(chainId),
    verifyingContract
  }
}

// -------- JoinTicket --------
// JoinTicket(address player,uint256 gameId,bytes32 inviteCodeHash,uint256 nonce,uint256 deadline,bool ackSuddenDeath,bool ackAutoPick)
export const JoinTicketTypes = {
  JoinTicket: [
    { name: 'player', type: 'address' },
    { name: 'gameId', type: 'uint256' },
    { name: 'inviteCodeHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'ackSuddenDeath', type: 'bool' },
    { name: 'ackAutoPick', type: 'bool' }
  ]
}

export function buildJoinTicketMessage({
  player,
  gameId,
  inviteCodeHash,
  nonce = 0,
  deadline = 0,
  ackSuddenDeath = true,
  ackAutoPick = true
}) {
  return {
    player,
    gameId: BigInt(gameId),
    inviteCodeHash,
    nonce: BigInt(nonce),
    deadline: BigInt(deadline),
    ackSuddenDeath,
    ackAutoPick
  }
}

// -------- Finalization --------
// Finalization(uint256 gameId,address[] players,uint32[] scores,address[] winners,uint32 roundCount,uint256 nonce,uint256 deadline,bytes32 roundsHash)
export const FinalizationTypes = {
  Finalization: [
    { name: 'gameId', type: 'uint256' },
    { name: 'players', type: 'address[]' },
    { name: 'scores', type: 'uint32[]' },
    { name: 'winners', type: 'address[]' },
    { name: 'roundCount', type: 'uint32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'roundsHash', type: 'bytes32' }
  ]
}

export function buildFinalizationMessage({
  gameId,
  players,
  scores,
  winners,
  roundCount,
  nonce,
  deadline,
  roundsHash
}) {
  return {
    gameId: BigInt(gameId),
    players,
    scores: scores.map(n => Number(n)), // uint32[]
    winners,
    roundCount: Number(roundCount),
    nonce: BigInt(nonce),
    deadline: BigInt(deadline),
    roundsHash
  }
}

export async function signTyped(signer, domain, types, message) {
  // ethers v6
  return await signer.signTypedData(domain, types, message)
}

// Helpers
export function inviteHash(rawCode) {
  const up = String(rawCode || '').trim().toUpperCase()
  return ethers.keccak256(ethers.toUtf8Bytes(up))
}

export function hashText(s) {
  return ethers.keccak256(ethers.toUtf8Bytes(String(s || '')))
}
