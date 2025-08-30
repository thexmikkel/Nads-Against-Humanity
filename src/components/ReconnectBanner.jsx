import React from 'react'

export default function ReconnectBanner({ gameId, onReconnect, onDismiss }) {
  return (
    <div className="bg-amber-500/10 border-y border-amber-500/30">
      <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-3">
        <span>Active game detected: <span className="font-mono">#{gameId}</span></span>
        <button onClick={onReconnect} className="ml-auto px-3 py-1 rounded bg-amber-500 text-slate-950">
          Reconnect
        </button>
        <button onClick={onDismiss} className="px-3 py-1 rounded border border-slate-600">
          Dismiss
        </button>
      </div>
    </div>
  )
}
