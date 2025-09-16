// /api/public-lobbies/add.js
import { kv } from '@vercel/kv'
import { ethers } from 'ethers'

const MONAD_ID = 10143
const ABI_GAME = [
  'function getGameStatus(uint256) view returns (uint8)',
  'function getGameMeta(uint256) view returns (address,bytes32,uint8,bool,uint64,uint64,uint256,uint256,bool,bool,bool)'
]

// EIP-712 types — must match client eip712.js
const PublishLobbyTypes = {
  PublishLobby: [
    { name: 'signer', type: 'address' },
    { name: 'gameId', type: 'uint256' },
    { name: 'inviteCodeHash', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
  ]
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return res.status(501).json({ error: 'Public lobby storage not configured' })
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const { gameId, code, signer, deadline, sig } = body

    if (!gameId || !code || !signer || !sig) {
      return res.status(400).json({ error: 'missing params' })
    }
    const codeUpper = String(code).trim().toUpperCase()
    if (!/^[A-Z0-9]{6}$/.test(codeUpper)) {
      return res.status(400).json({ error: 'bad code format' })
    }

    const now = Math.floor(Date.now() / 1000)
    if (deadline && Number(deadline) < now) {
      return res.status(400).json({ error: 'signature expired' })
    }

    const rpc = process.env.RPC_URL || 'https://testnet-rpc.monad.xyz/'
    const provider = new ethers.JsonRpcProvider(rpc)
    const gameAddr = process.env.GAME_ADDRESS
    if (!gameAddr) return res.status(500).json({ error: 'GAME_ADDRESS not set' })
    const G = new ethers.Contract(gameAddr, ABI_GAME, provider)

    const gid = BigInt(gameId)
    const meta = await G.getGameMeta(gid)
    const status = Number(await G.getGameStatus(gid)) // 1 Lobby, 2 Started, 3 Finished, 4 Cancelled
    if (status !== 1) return res.status(400).json({ error: 'game not in lobby' })

    const creator     = meta[0]
    const inviteHash  = meta[1]
    const maxPlayers  = Number(meta[2])
    const usePrize    = Boolean(meta[3])
    const expiryTs    = Number(meta[5])
    const prizeAmount = meta[6] // uint256

    if (expiryTs <= now) return res.status(400).json({ error: 'lobby expired' })

    // Code consistency
    const codeHash = ethers.keccak256(ethers.toUtf8Bytes(codeUpper))
    if (codeHash !== inviteHash) {
      return res.status(400).json({ error: 'code does not match game' })
    }

    // Verify creator signature using the same domain as your app (MonadCAH v1)
    const domain = {
      name: 'MonadCAH',
      version: '1',
      chainId: MONAD_ID,
      verifyingContract: gameAddr
    }
    const value = {
      signer: ethers.getAddress(signer),
      gameId: gid,
      inviteCodeHash: codeHash,
      deadline: BigInt(deadline || 0)
    }

    let recovered
    try {
      recovered = ethers.verifyTypedData(domain, PublishLobbyTypes, value, sig)
    } catch {
      return res.status(400).json({ error: 'bad signature' })
    }
    if (ethers.getAddress(recovered) !== ethers.getAddress(creator)) {
      return res.status(403).json({ error: 'not creator' })
    }

    // Store chain-derived fields
    const item = {
      gameId: Number(gameId),
      code: codeUpper,
      expiresAt: expiryTs,
      maxPlayers,
      creator,
      usePrize,
      prizeAmount: prizeAmount.toString(),
      createdAt: now
    }

    let list = (await kv.get('public:lobbies')) || []
    const i = list.findIndex(x => Number(x.gameId) === Number(gameId))
    if (i >= 0) list[i] = item; else list.push(item)
    await kv.set('public:lobbies', list)

    return res.json({ ok: true, item })
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'failed' })
  }
}
