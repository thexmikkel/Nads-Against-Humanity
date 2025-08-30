import React from 'react'
import { Link } from 'react-router-dom'
import MagicBackground from '../ui/MagicBackground' // adjust path if needed

export default function Docs() {
  return (
    <div className="relative min-h-screen">
      {/* animated bg */}
      <MagicBackground />

      {/* content */}
      <main className="relative z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 backdrop-blur p-6 sm:p-8 text-slate-100">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
              <h1 className="text-3xl font-bold">Nads Against Humanity — Docs</h1>
              <Link
                to="/"
                className="sm:ml-auto inline-flex items-center px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700"
              >
                ← Back to app
              </Link>
            </div>

            <p className="text-slate-300">
              Welcome! This page explains how to play, how wallets & usernames work, how to deposit/withdraw MON,
              and what to do if something goes wrong. It’s written for beginners—no crypto experience needed.
            </p>

            {/* TOC */}
            <nav className="mt-6 grid sm:grid-cols-2 gap-2 text-sm">
              {[
                ['#quickstart', 'Quick start'],
                ['#wallets', 'Wallets & usernames'],
                ['#create', 'Create a game'],
                ['#join', 'Join a game'],
                ['#finalize', 'End & scores'],
                ['#leaderboard', 'Leaderboard'],
                ['#deposit', 'Deposit / Withdraw'],
                ['#troubleshooting', 'Troubleshooting'],
              ].map(([href, label]) => (
                <a key={href} href={href} className="px-3 py-2 rounded-lg bg-slate-800/70 border border-slate-700 hover:bg-slate-700/70">
                  {label}
                </a>
              ))}
            </nav>

            <section id="quickstart" className="mt-10">
              <h2 className="text-2xl font-semibold mb-3">Quick start</h2>
              <ol className="list-decimal pl-5 space-y-2 text-slate-300">
                <li>Click <span className="text-slate-100 font-medium">Login</span> and follow the steps. We create a secure embedded wallet for you.</li>
                <li>(Optional) Link your <span className="text-slate-100 font-medium">Monad Games ID</span> to show a username & appear on the global leaderboard.</li>
                <li>Hit <span className="text-slate-100 font-medium">Create a game</span> or <span className="text-slate-100 font-medium">Join a game</span>.</li>
                <li>Play rounds. When the lobby is full, the game starts; a judge picks winning cards each round.</li>
                <li>At the end, the contract finalizes results and pays the winner automatically.</li>
              </ol>
            </section>

            <section id="wallets" className="mt-10">
              <h2 className="text-2xl font-semibold mb-3">Wallets & usernames</h2>
              <p className="text-slate-300">
                You’ll see two addresses:
              </p>
              <ul className="list-disc pl-5 text-slate-300 mt-2 space-y-1">
                <li><span className="text-slate-100 font-medium">Embedded wallet</span> — used for all in-game transactions (fast, no browser extension).</li>
                <li><span className="text-slate-100 font-medium">Monad Games ID address</span> — used for username + global leaderboard identity.</li>
              </ul>
              <p className="text-slate-300 mt-2">
                We link them so your scores show next to your username while your embedded wallet signs the game txs.
              </p>
            </section>

            <section id="create" className="mt-10">
              <h2 className="text-2xl font-semibold mb-3">Create a game</h2>
              <ul className="list-disc pl-5 text-slate-300 space-y-1">
                <li>Click <span className="text-slate-100 font-medium">Create a game</span>, choose players, lobby timer, and optional prize.</li>
                <li>Share the invite code with friends. When the lobby is full, the game starts.</li>
              </ul>
            </section>

            <section id="join" className="mt-10">
              <h2 className="text-2xl font-semibold mb-3">Join a game</h2>
              <ul className="list-disc pl-5 text-slate-300 space-y-1">
                <li>Click <span className="text-slate-100 font-medium">Join a game</span> and paste the invite code.</li>
                <li>We do it in one transaction when possible (smoother for beginners).</li>
              </ul>
            </section>

            <section id="finalize" className="mt-10">
              <h2 className="text-2xl font-semibold mb-3">End & scores</h2>
              <p className="text-slate-300">
                When the final round ends, the contract finalizes the match, sends the prize to the winner,
                and (if enabled) pushes your score to the global leaderboard.
              </p>
            </section>

            <section id="leaderboard" className="mt-10">
              <h2 className="text-2xl font-semibold mb-3">Leaderboard</h2>
              <p className="text-slate-300">
                Scores are tied to your Monad Games ID address. If you only see an address and not your alias,
                link your ID in the profile menu and play one match to update.
              </p>
            </section>

            <section id="deposit" className="mt-10">
              <h2 className="text-2xl font-semibold mb-3">Deposit / Withdraw</h2>
              <ul className="list-disc pl-5 text-slate-300 space-y-1">
                <li><span className="text-slate-100 font-medium">Deposit:</span> send MON to your embedded wallet address (shown in profile).</li>
                <li><span className="text-slate-100 font-medium">Withdraw:</span> open the profile menu → <em>Withdraw</em>.
                  You can send MON to any 0x address. Gas is automatically accounted for.</li>
              </ul>
            </section>

            <section id="troubleshooting" className="mt-10">
              <h2 className="text-2xl font-semibold mb-3">Troubleshooting</h2>
              <ul className="list-disc pl-5 text-slate-300 space-y-2">
                <li><span className="text-slate-100 font-medium">“Wallet not ready”</span> — wait a second after login; if it persists, refresh and re-login.</li>
                <li><span className="text-slate-100 font-medium">Finalize failed</span> — it will retry; ensure the last player joined fully and you’re on the right network.</li>
                <li><span className="text-slate-100 font-medium">Leaderboard not updating</span> — link your Monad Games ID, then finish one match.</li>
                <li><span className="text-slate-100 font-medium">Withdraw errors</span> — enter a valid 0x address and an amount &lt;= balance; try “Withdraw MAX”.</li>
              </ul>
              <p className="text-slate-300 mt-4">
                Need help? Ping us on Discord (link in footer).
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}
