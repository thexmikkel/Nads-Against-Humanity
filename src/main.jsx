// src/main.jsx
import { Buffer } from 'buffer'
if (!window.Buffer) window.Buffer = Buffer
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { PrivyProvider } from '@privy-io/react-auth'
import { defineChain } from 'viem'   // per Privy docs

const appId = import.meta.env.VITE_PRIVY_APP_ID
const rpcUrl = import.meta.env.VITE_RPC_URL || 'https://testnet-rpc.monad.xyz'

// Define Monad Testnet (since it's not in viem/chains by default)
export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  network: 'monad-testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: { default: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' } },
})

function MissingEnv() {
  return (
    <div style={{ padding: 24, color: '#e11d48', fontFamily: 'ui-sans-serif,system-ui' }}>
      <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Missing VITE_PRIVY_APP_ID</h1>
      <p>Add it to your <code>.env</code> and Vercel → Project → Settings → Environment Variables.</p>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  appId ? (
    <React.StrictMode>
      <PrivyProvider
        appId={appId}
        config={{
          // Only Monad Games ID as a login option
          loginMethodsAndOrder: { primary: ['privy:cmd8euall0037le0my79qpz42'] },
          embeddedWallets: { createOnLogin: 'users-without-wallets' },

          // Tell Privy which chain to use
          defaultChain: monadTestnet,
          supportedChains: [monadTestnet],
        }}
      >
        <App />
      </PrivyProvider>
    </React.StrictMode>
  ) : (
    <MissingEnv />
  )
)
