// src/hooks/useMyLBScore.js
// ethers v6
import { useEffect, useMemo, useState } from 'react'
import { ethers } from 'ethers'
import { usePrivy } from '@privy-io/react-auth'

const ABI = [
  'function playerDataPerGame(address game,address player) view returns (uint256 score,uint256 transactions)'
]

// Set to your Games ID provider (defaults to the one in the docs)
const GID_APP_ID = import.meta.env.VITE_MONAD_GID_APP_ID || 'cmd8euall0037le0my79qpz42'

function getGamesIdAddressFromPrivyUser(user) {
  try {
    const cross = user?.linkedAccounts?.find?.(
      (acc) => acc.type === 'cross_app' && acc.providerApp?.id === GID_APP_ID
    )
    const addr = cross?.embeddedWallets?.[0]?.address
    return addr && ethers.isAddress(addr) ? ethers.getAddress(addr) : ''
  } catch {
    return ''
  }
}

export default function useMyLBScore(embeddedAddr) {
  const { user } = usePrivy()
  const [state, setState] = useState({
    loading: false,
    score: '0',
    txs: '0',
    error: null,
    usedAddress: null, // which address we queried on the LB
  })

  const LB   = import.meta.env.VITE_LEADERBOARD_ADDRESS
  const GAME = import.meta.env.VITE_GAME_ADDRESS
  const RPC  = import.meta.env.VITE_RPC_URL

  // Prefer Games-ID address if available; else fall back to embedded
  const gidAddr = getGamesIdAddressFromPrivyUser(user)
  const playerToQuery = useMemo(() => {
    // If gid addr exists, use it; else use embedded
    const cand = gidAddr || embeddedAddr || ''
    try { return ethers.isAddress(cand) ? ethers.getAddress(cand) : '' } catch { return '' }
  }, [gidAddr, embeddedAddr])

  const ok = useMemo(() => {
    try {
      return (
        playerToQuery &&
        ethers.isAddress(playerToQuery) &&
        ethers.isAddress(LB) &&
        ethers.isAddress(GAME) &&
        !!RPC
      )
    } catch {
      return false
    }
  }, [playerToQuery, LB, GAME, RPC])

  useEffect(() => {
    let alive = true
    async function run() {
      if (!ok) { setState(s => ({ ...s, loading: false, usedAddress: playerToQuery })); return }
      try {
        setState({ loading: true, score: '0', txs: '0', error: null, usedAddress: playerToQuery })
        const provider = new ethers.JsonRpcProvider(RPC)
        const lb = new ethers.Contract(ethers.getAddress(LB), ABI, provider)
        const r = await lb.playerDataPerGame(
          ethers.getAddress(GAME),
          ethers.getAddress(playerToQuery)
        )
        if (!alive) return
        setState({
          loading: false,
          score: r.score.toString(),
          txs: r.transactions.toString(),
          error: null,
          usedAddress: playerToQuery,
        })
      } catch (e) {
        if (!alive) return
        setState({
          loading: false,
          score: '0',
          txs: '0',
          error: e?.message || String(e),
          usedAddress: playerToQuery,
        })
      }
    }
    run()
    return () => { alive = false }
  }, [ok, playerToQuery, LB, GAME, RPC])

  return state // { loading, score, txs, error, usedAddress }
}
