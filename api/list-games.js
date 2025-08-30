import { ethers } from 'ethers'
import abi from '../src/abi/abiGame.js'

export default async function handler(req, res) {
  try {
    const RPC_URL = process.env.RPC_URL
    const GAME_ADDRESS = process.env.GAME_ADDRESS
    if (!RPC_URL || !GAME_ADDRESS) {
      return res.status(500).json({ error: 'RPC_URL/GAME_ADDRESS not set' })
    }
    const provider = new ethers.JsonRpcProvider(RPC_URL)
    const iface = new ethers.Interface(abi)

    const T_GAME_CREATED = ethers.id('GameCreated(uint256,bytes32,address,bool,uint256,uint256)')

    // Fetch all GameCreated logs (you can narrow fromBlock later if needed)
    const logs = await provider.getLogs({
      address: GAME_ADDRESS,
      topics: [T_GAME_CREATED],
      fromBlock: 0,
      toBlock: 'latest',
    })

    const items = logs.map((log) => {
      const ev = iface.parseLog(log)
      const gameId = Number(ev.args?.[0] ?? ev.args?.gameId ?? 0)
      const inviteHash = String(ev.args?.[1])
      const creator = String(ev.args?.[2])
      const usePrize = Boolean(ev.args?.[3])
      const prizeAmount = ev.args?.[4] ? ev.args[4].toString() : '0'
      const fee = ev.args?.[5] ? ev.args[5].toString() : '0'
      return {
        gameId,
        inviteHash,
        creator,
        usePrize,
        prizeAmount,
        fee,
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
      }
    })

    // also include a quick sanity: code present + gameCount
    const game = new ethers.Contract(GAME_ADDRESS, abi, provider)
    const code = await provider.getCode(GAME_ADDRESS)
    const gameCount = await game.gameCount().catch(() => 0)

    return res.status(200).json({
      ok: true,
      address: GAME_ADDRESS,
      hasCode: code && code !== '0x',
      gameCount: Number(gameCount),
      created: items,
    })
  } catch (e) {
    console.error('[list-games] error', e)
    return res.status(500).json({ error: e?.message || 'list failed' })
  }
}
