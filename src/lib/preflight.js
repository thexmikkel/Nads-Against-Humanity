// src/lib/preflight.js
import { ethers } from 'ethers'

export async function preflightGame(getGame) {
  const c = await getGame()
  const provider = c.runner?.provider || c.provider
  const address = c.target?.toString?.() || c.address
  const [network, code, fee] = await Promise.all([
    provider.getNetwork(),
    provider.getCode(address),
    c.gameFee().catch(() => null)
  ])

  return {
    address,
    chainId: Number(network.chainId),
    hasCode: code && code !== '0x',
    feeWei: fee,
    ok: code && code !== '0x' && Number(network.chainId) === 10143 && fee != null
  }
}
