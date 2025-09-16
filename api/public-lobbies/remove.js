// /api/public-lobbies/remove.js
import { kv } from '@vercel/kv'
import { ethers } from 'ethers'

const MONAD_ID = 10143
const ABI_GAME = [
  'function getGameStatus(uint256) view returns (uint8)',
  'function getGameMeta(uint256) view returns (address,bytes32,uint8,bool,uint64,uint64,uint256,uint256,bool,bool,bool)'
]

const UnpublishLobbyTypes = {
  UnpublishLobby: [
    { name: 'signer', type: 'address' },
    { name: 'gameId', type: 'uint256' },
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
    const { gameId, signer, deadline, sig } = body
    if (!gameId) return res.status(400).json({ error: 'gameId required' })

    const rpc = process.env.RPC_URL || 'https://testnet-rpc.monad.xyz/'
    const provider = new ethers.JsonRpcProvider(rpc)
    const gameAddr = process.env.GAME_ADDRESS
    if (!gameAddr) return res.status(500).json({ error: 'GAME_ADDRESS not set' })
    const G = new ethers.Contract(gameAddr, ABI_GAME, provider)

    const gid = BigInt(gameId)
    const meta = await G.getGameMeta(gid)
    const status = Number(await G.getGameStatus(gid)) // 1 Lobby, else not joinable
    const expiryTs = Number(meta?.[5] || 0)
    const now = Math.floor(Date.now() / 1000)

    const notJoinable = status !== 1 || (expiryTs && now >= expiryTs)

    if (!notJoinable) {
      // Require creator signature to unpublish an active lobby
      if (!signer || !sig) return res.status(403).json({ error: 'signature required' })
      if (deadline && Number(deadline) < now) return res.status(400).json({ error: 'signature expired' })
      const creator = meta[0]

      const domain = {
        name: 'MonadCAH',
        version: '1',
        chainId: MONAD_ID,
        verifyingContract: gameAddr
      }
      const value = {
        signer: ethers.getAddress(signer),
        gameId: gid,
        deadline: BigInt(deadline || 0)
      }
      let recovered
      try {
        recovered = ethers.verifyTypedData(domain, UnpublishLobbyTypes, value, sig)
      } catch {
        return res.status(400).json({ error: 'bad signature' })
      }
      if (ethers.getAddress(recovered) !== ethers.getAddress(creator)) {
        return res.status(403).json({ error: 'not creator' })
      }
    }

    let list = (await kv.get('public:lobbies')) || []
    list = list.filter(x => Number(x.gameId) !== Number(gameId))
    await kv.set('public:lobbies', list)

    return res.json({ ok: true })
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'failed' })
  }
}
