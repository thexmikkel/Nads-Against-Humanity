// src/hooks/useContracts.js
import { useMemo } from 'react'
import { ethers } from 'ethers'
import abiGame from '../abi/abiGame.js'
import abiCards from '../abi/abiCards.js'

// --- Env & constants ---------------------------------------------------------
const GAME_ADDRESS  = (import.meta.env.VITE_GAME_ADDRESS  || import.meta.env.VITE_GAME_ADDR  || '').trim()
const CARDS_ADDRESS = (import.meta.env.VITE_CARDS_ADDRESS || import.meta.env.VITE_CARDS_ADDR || '').trim()

// Allow multiple RPCs via comma-separated env (prefer VITE_RPC_URLS, fallback to VITE_RPC_URL)
const RPC_URLS = (import.meta.env.VITE_RPC_URLS || import.meta.env.VITE_RPC_URL || 'https://testnet-rpc.monad.xyz/')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const MONAD_ID  = 10143
const MONAD_HEX = '0x279f'

// Minimal Monad Testnet chain params for wallet_addEthereumChain
const MONAD_CHAIN_PARAMS = {
  chainId: MONAD_HEX,
  chainName: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: RPC_URLS.length ? RPC_URLS : ['https://testnet-rpc.monad.xyz/'],
  blockExplorerUrls: ['https://testnet.monadexplorer.com/'],
}

// --- Hook --------------------------------------------------------------------
export default function useContracts(embedded) {
  // 1) Read-only provider (never triggers wallet)
  const readProvider = useMemo(() => {
    // If you provided multiple RPCs, take the first; (you can add cycling later)
    const url = RPC_URLS[0]
    try {
      return new ethers.JsonRpcProvider(url, MONAD_ID)
    } catch {
      // Fallback without explicit chain id
      return new ethers.JsonRpcProvider(url)
    }
  }, [])

  // 2) Read-only GAME contract
  const getGameRead = useMemo(() => {
    if (!readProvider || !GAME_ADDRESS) return async () => { throw new Error('Read provider or game address missing') }
    const instance = new ethers.Contract(GAME_ADDRESS, abiGame, readProvider)
    return async () => instance
  }, [readProvider])

  // 3) Read-only CARDS contract
  const getCards = useMemo(() => {
    if (!readProvider || !CARDS_ADDRESS) return async () => { throw new Error('Read provider or cards address missing') }
    const instance = new ethers.Contract(CARDS_ADDRESS, abiCards, readProvider)
    return async () => instance
  }, [readProvider])

  // Helper to ensure wallet is on Monad Testnet
  async function ensureMonadChain(provider) {
    const net = await provider.getNetwork()
    if (Number(net.chainId) === MONAD_ID) return

    try {
      await provider.send('wallet_switchEthereumChain', [{ chainId: MONAD_HEX }])
      return
    } catch (err) {
      const msg = String(err?.message || '')
      const needsAdd = err?.code === 4902 || /unknown chain|addEthereumChain|unrecognized|not added/i.test(msg)
      if (!needsAdd) throw err
      // Add + switch
      await provider.send('wallet_addEthereumChain', [MONAD_CHAIN_PARAMS])
      await provider.send('wallet_switchEthereumChain', [{ chainId: MONAD_HEX }])
    }
  }

  // 4) Signer-backed GAME contract (for transactions)
  const getGame = useMemo(() => {
    return async () => {
      if (!embedded) throw new Error('Wallet not ready')
      if (!GAME_ADDRESS) throw new Error('Game contract not configured')

      // Privy embedded wallet → EIP-1193 provider
      const eip1193 = await embedded.getEthereumProvider?.()
      if (!eip1193) throw new Error('Embedded provider unavailable')

      // Ethers v6 BrowserProvider + signer
      const browserProvider = new ethers.BrowserProvider(eip1193)
      await ensureMonadChain(browserProvider) // always ensure chain before we hand back a signer/contract

      const signer = await browserProvider.getSigner()
      return new ethers.Contract(GAME_ADDRESS, abiGame, signer)
    }
  }, [embedded])

  return { getGame, getGameRead, getCards, readProvider }
}
