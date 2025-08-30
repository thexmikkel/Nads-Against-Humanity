// src/hooks/useContracts.js
import { useMemo } from 'react'
import { ethers } from 'ethers'
import abiGame from '../abi/abiGame.js'
import abiCards from '../abi/abiCards.js'

const GAME_ADDRESS  = (import.meta.env.VITE_GAME_ADDR  || '').trim()
const CARDS_ADDRESS = (import.meta.env.VITE_CARDS_ADDR || '').trim()
const RPC_URLS      = (import.meta.env.VITE_RPC_URL || import.meta.env.VITE_RPC_URLs || 'https://testnet-rpc.monad.xyz/')
  .split(',').map(s => s.trim()).filter(Boolean)

const MONAD_ID  = 10143
const MONAD_HEX = '0x279f'

export default function useContracts(embedded) {
  // ---- Read-only provider (never prompts a wallet) ----
  const readProvider = useMemo(() => {
    // Use first RPC; you can expand to round-robin if you like.
    const url = RPC_URLS[0]
    if (!url) return null
    try {
      return new ethers.JsonRpcProvider(url, MONAD_ID)
    } catch {
      // Some providers don’t like the explicit chain param
      return new ethers.JsonRpcProvider(url)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // env doesn’t change at runtime; keep stable for memoization

  // ---- Read-only GAME contract ----
  const getGameRead = useMemo(() => {
    if (!readProvider || !GAME_ADDRESS) return null
    const instance = new ethers.Contract(GAME_ADDRESS, abiGame, readProvider)
    // return async for uniform call sites: `const game = await getGameRead()`
    return async () => instance
  }, [readProvider, GAME_ADDRESS])

  // ---- Read-only CARDS contract ----
  const getCards = useMemo(() => {
    if (!readProvider || !CARDS_ADDRESS) return null
    const instance = new ethers.Contract(CARDS_ADDRESS, abiCards, readProvider)
    return async () => instance
  }, [readProvider, CARDS_ADDRESS])

  // ---- Signer-backed GAME contract (for tx) ----
  const getGame = useMemo(() => {
    return async () => {
      if (!embedded) throw new Error('Wallet not ready')
      if (!GAME_ADDRESS) throw new Error('Game contract not configured')

      // EIP-1193 provider from Privy embedded wallet
      const eip1193 = await embedded.getEthereumProvider()
      const provider = new ethers.BrowserProvider(eip1193)
      const signer   = await provider.getSigner()

      // Ensure correct chain (Monad testnet)
      const net = await provider.getNetwork()
      if (Number(net.chainId) !== MONAD_ID) {
        try {
          await provider.send('wallet_switchEthereumChain', [{ chainId: MONAD_HEX }])
        } catch (err) {
          const needsAdd = err?.code === 4902 || /addEthereumChain|unknown chain/i.test(String(err?.message || ''))
          if (needsAdd) {
            await provider.send('wallet_addEthereumChain', [{
              chainId: MONAD_HEX,
              chainName: 'Monad Testnet',
              nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
              rpcUrls: RPC_URLS,
              blockExplorerUrls: ['https://testnet.monadexplorer.com/'],
            }])
            await provider.send('wallet_switchEthereumChain', [{ chainId: MONAD_HEX }])
          } else {
            throw err
          }
        }
      }

      return new ethers.Contract(GAME_ADDRESS, abiGame, signer)
    }
  }, [embedded])

  return { getGame, getGameRead, getCards, readProvider }
}
