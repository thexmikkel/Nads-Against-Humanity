import React from 'react'

export default function GameTopbar({ gameId, inviteCode, playersNow, round }) {
  return (
    <section className="mt-2 p-4 border border-slate-800 rounded-xl bg-slate-900">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          Game ID: <span className="font-mono">#{gameId}</span>
          <button className="underline ml-1" onClick={() => navigator.clipboard.writeText(String(gameId))}>Copy</button>
        </div>
        <div className="opacity-50">•</div>
        <div>
          Invite: <span className="font-mono">{inviteCode || '—'}</span>
          <button className="underline ml-1" onClick={() => inviteCode && navigator.clipboard.writeText(inviteCode)}>Copy</button>
        </div>
        <div className="opacity-50">•</div>
        <div>Players {playersNow || 1}</div>
        <div className="opacity-50">•</div>
        <div>Round {round}/15</div>
        <div className="ml-auto">
          <button className="px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700" onClick={() => document.getElementById('recallModal').showModal()}>
            Recall stats
          </button>
        </div>
      </div>
    </section>
  )
}
