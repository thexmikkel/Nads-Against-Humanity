// src/pages/Cards.jsx
import React from 'react'
import { ethers } from 'ethers'
import abiCards from '../abi/abiCards.js'
import { toast } from '../lib/toast.jsx'

const PAGE = 60

// local vote storage key
const VOTE_KEY = 'cah:votes' // { "prompt:123": 1|-1, "answer:55": 1|-1 }
function loadVotes() {
  try { return JSON.parse(localStorage.getItem(VOTE_KEY) || '{}') } catch { return {} }
}
function saveVotes(v) { try { localStorage.setItem(VOTE_KEY, JSON.stringify(v)) } catch {} }

export default function Cards({ address, getCards }) {
  const me = (address || '').toLowerCase()
  const [tab, setTab] = React.useState('prompts') // 'prompts' | 'answers'
  const [onlyActive, setOnlyActive] = React.useState(true)
  const [q, setQ] = React.useState('')
  const [pageStart, setPageStart] = React.useState(1)
  const [rows, setRows] = React.useState([])
  const [total, setTotal] = React.useState(0)
  const [isMod, setIsMod] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [showAdmin, setShowAdmin] = React.useState(false)
  const [votes, setVotes] = React.useState(loadVotes)

  const cardsRef = React.useRef(null)

  // boot: check roles
  React.useEffect(() => {
    (async () => {
      try {
        const G = await getCards()
        // in case getCards returns a read-only contract, swap to signer if you need to send txs
        const provider = G.runner?.provider || G.provider
        const addr = await (G.runner?.getAddress?.() || G.signer?.getAddress?.() || Promise.resolve(address))
        const devRole = await G.DEV_ROLE()
        const modRole = await G.MOD_ROLE()
        const isDev = await G.hasRole(devRole, addr)
        const isModX = await G.hasRole(modRole, addr)
        setIsMod(Boolean(isDev || isModX))
      } catch { setIsMod(false) }
    })()
  }, [getCards, address])

  // fetch a page
  async function loadPage(start = pageStart, only = onlyActive, query = q, which = tab) {
    try {
      const G = await getCards()
      const provider = G.runner?.provider || G.provider
      const addr = await G.getAddress?.()
      const iface = new ethers.Interface(abiCards)

      let count = 0
      if (which === 'prompts') count = Number(await G.promptCount())
      else count = Number(await G.answerCount())

      let ids=[], texts=[], imageRefs=[], actives=[]
      if (which === 'prompts') {
        const res = await G.pagePrompts(start, PAGE, Boolean(only))
        ids = Array.from(res[0]).map(Number)
        texts = Array.from(res[1])
        imageRefs = Array.from(res[2]).map(Number)
        actives = Array.from(res[3]).map(Boolean)
      } else {
        const res = await G.pageAnswers(start, PAGE, Boolean(only))
        ids = Array.from(res[0]).map(Number)
        texts = Array.from(res[1])
        imageRefs = Array.from(res[2]).map(Number)
        actives = Array.from(res[3]).map(Boolean)
      }

      let rows = ids.map((id, i) => ({
        id, text: texts[i] || '', imageRef: imageRefs[i] || 0, active: actives[i] || false
      }))

      // filter in-memory by query
      const qq = (query || '').trim().toLowerCase()
      if (qq) rows = rows.filter(r => r.text.toLowerCase().includes(qq) || String(r.id).includes(qq))

      setRows(rows)
      setTotal(count)
    } catch (e) {
      console.warn('load cards page failed', e)
      setRows([])
      setTotal(0)
    }
  }

  React.useEffect(() => { loadPage() }, []) // initial
  React.useEffect(() => { loadPage(1, onlyActive, q, tab); setPageStart(1) }, [tab])
  React.useEffect(() => { loadPage(pageStart, onlyActive, q, tab) }, [pageStart, onlyActive])
  React.useEffect(() => {
    const t = setTimeout(() => loadPage(1, onlyActive, q, tab), 200)
    return () => clearTimeout(t)
  }, [q])

  function pageNext() {
    const next = pageStart + PAGE
    if (next <= total) setPageStart(next)
  }
  function pagePrev() {
    const prev = pageStart - PAGE
    setPageStart(prev > 0 ? prev : 1)
  }

  // thumbs up/down (local first, optional API)
  function setVote(kind, id, val) {
    setVotes(prev => {
      const next = { ...prev, [`${kind}:${id}`]: val }
      saveVotes(next)
      return next
    })
    // optional: POST to backend (no-op if endpoint missing)
    ;(async () => {
      try {
        await fetch('/api/cards/vote', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind, id, vote: val, from: address })
        })
      } catch {}
    })()
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header row */}
      <div className="flex items-center gap-3 mb-6">
        <div className="inline-flex rounded-lg p-[1px] bg-gradient-to-r from-indigo-600 to-fuchsia-600">
          <div className="rounded-lg bg-slate-900">
            <button
              onClick={() => setTab('prompts')}
              className={`px-3 py-1.5 text-sm rounded-l-lg ${tab==='prompts'?'bg-slate-800':'hover:bg-slate-800/50'}`}
            >
              Prompts
            </button>
            <button
              onClick={() => setTab('answers')}
              className={`px-3 py-1.5 text-sm rounded-r-lg ${tab==='answers'?'bg-slate-800':'hover:bg-slate-800/50'}`}
            >
              Answers
            </button>
          </div>
        </div>

        <label className="ml-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyActive} onChange={e => setOnlyActive(e.target.checked)} />
          Only active
        </label>

        <div className="ml-auto flex items-center gap-2">
          <input
            placeholder="Search text or ID…"
            className="px-3 py-2 rounded-lg bg-slate-900 border border-white/10 w-64"
            value={q}
            onChange={e => setQ(e.target.value)}
          />

          {isMod && (
            <button
              className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500"
              onClick={() => setShowAdmin(true)}
            >
              Admin
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rows.map((r) => {
          const k = `${tab==='prompts'?'prompt':'answer'}:${r.id}`
          const myVote = votes[k] || 0
          return (
            <CardRow
              key={k}
              kind={tab==='prompts'?'prompt':'answer'}
              row={r}
              myVote={myVote}
              onVote={(val) => setVote(tab==='prompts'?'prompt':'answer', r.id, val)}
              isMod={isMod}
              getCards={getCards}
              onChanged={() => loadPage(pageStart, onlyActive, q, tab)}
            />
          )
        })}
      </div>

      {/* Pager */}
      <div className="mt-6 flex items-center justify-center gap-2">
        <button onClick={pagePrev} className="px-3 py-1.5 rounded bg-slate-800 border border-slate-700">Prev</button>
        <div className="text-sm text-slate-400">
          {pageStart}–{Math.min(pageStart + PAGE - 1, total)} of {total || 0}
        </div>
        <button onClick={pageNext} className="px-3 py-1.5 rounded bg-slate-800 border border-slate-700">Next</button>
      </div>

      {showAdmin && (
        <AdminModal kind={tab} onClose={() => setShowAdmin(false)} getCards={getCards} />
      )}
    </div>
  )
}

function CardRow({ kind, row, myVote, onVote, isMod, getCards, onChanged }) {
  const [editing, setEditing] = React.useState(false)
  const [text, setText] = React.useState(row.text)
  const [img, setImg] = React.useState(row.imageRef)
  const [busy, setBusy] = React.useState(false)

  async function toggleActive(next) {
    try {
      setBusy(true)
      const G = await getCards()
      if (kind === 'prompt') {
        const tx = await G.setPromptActive(row.id, Boolean(next))
        await tx.wait()
      } else {
        const tx = await G.setAnswerActive(row.id, Boolean(next))
        await tx.wait()
      }
      onChanged?.()
      toast(next ? 'Unhidden' : 'Hidden', next ? 'success' : 'warn')
    } catch (e) {
      toast(e?.shortMessage || e?.message || 'Toggle failed', 'error')
    } finally { setBusy(false) }
  }

  async function saveEdit() {
    try {
      setBusy(true)
      const G = await getCards()
      if (kind === 'prompt') {
        const tx = await G.editPrompt(row.id, String(text), Number(img)||0)
        await tx.wait()
      } else {
        const tx = await G.editAnswer(row.id, String(text), Number(img)||0)
        await tx.wait()
      }
      setEditing(false)
      onChanged?.()
      toast('Saved', 'success')
    } catch (e) {
      toast(e?.shortMessage || e?.message || 'Save failed', 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs text-slate-400">
          #{row.id} {row.active ? (
            <span className="ml-2 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-700/40 text-emerald-300">active</span>
          ) : (
            <span className="ml-2 px-2 py-0.5 rounded bg-slate-700/40 border border-slate-600/30 text-slate-300">hidden</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* thumbs */}
          <button
            title="thumbs up"
            onClick={() => onVote(myVote === 1 ? 0 : 1)}
            className={`px-2 py-1 rounded ${myVote===1?'bg-emerald-600/30 border border-emerald-600/60':'bg-slate-800 border border-slate-700'}`}
          >👍</button>
          <button
            title="thumbs down"
            onClick={() => onVote(myVote === -1 ? 0 : -1)}
            className={`px-2 py-1 rounded ${myVote===-1?'bg-rose-600/30 border border-rose-600/60':'bg-slate-800 border border-slate-700'}`}
          >👎</button>

          {/* admin actions */}
          {isMod && !editing && (
            <>
              <button className="px-2 py-1 rounded bg-white/5 border border-white/10 hover:bg-white/10"
                      onClick={() => setEditing(true)}>Edit</button>
              <button className="px-2 py-1 rounded bg-white/5 border border-white/10 hover:bg-white/10"
                      onClick={() => toggleActive(!row.active)} disabled={busy}>
                {row.active ? 'Hide' : 'Unhide'}
              </button>
            </>
          )}
        </div>
      </div>

      {!editing ? (
        <div className="mt-2 text-sm whitespace-pre-wrap leading-relaxed">{row.text || <i>(empty)</i>}</div>
      ) : (
        <div className="mt-3 space-y-2">
          <textarea
            rows={3}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700"
            value={text}
            onChange={e => setText(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">imageRef</label>
            <input className="px-2 py-1 rounded bg-slate-800 border border-slate-700 w-24"
                   value={img} onChange={e => setImg(e.target.value.replace(/\D/g,''))} />
            <div className="ml-auto flex items-center gap-2">
              <button className="px-3 py-1.5 rounded bg-white/5 border border-white/10 hover:bg-white/10" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
              <button className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500" onClick={saveEdit} disabled={busy}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AdminModal({ kind, onClose, getCards }) {
  const [mode, setMode] = React.useState('single') // 'single' | 'batch'
  const [text, setText] = React.useState('')
  const [img, setImg] = React.useState('')
  const [batch, setBatch] = React.useState('') // CSV/TSV/pipe or lines
  const [busy, setBusy] = React.useState(false)

  function parseBatch(s) {
    // Accept lines like:
    // text|123
    // Some text only
    // "text, with comma",45
    const lines = (s || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const texts = []
    const imageRefs = []
    for (const line of lines) {
      let t = line, ref = '0'
      const mPipe = line.split('|')
      if (mPipe.length >= 2) { t = mPipe.slice(0, -1).join('|'); ref = mPipe.at(-1) }
      else {
        const mCsv = line.split(',') // naive but okay
        if (mCsv.length >= 2) { t = mCsv.slice(0, -1).join(','); ref = mCsv.at(-1) }
      }
      texts.push(t.trim())
      imageRefs.push(String(ref || '0').replace(/\D/g,'') || '0')
    }
    return { texts, imageRefs: imageRefs.map(n => Number(n) || 0) }
  }

  async function submit() {
    try {
      setBusy(true)
      const G = await getCards()
      if (mode === 'single') {
        const texts = [text.trim()]
        const imageRefs = [Number(String(img || '0').replace(/\D/g,'')) || 0]
        if (kind === 'prompts') {
          const tx = await G.addPromptBatch(texts, imageRefs); await tx.wait()
        } else {
          const tx = await G.addAnswerBatch(texts, imageRefs); await tx.wait()
        }
      } else {
        const { texts, imageRefs } = parseBatch(batch)
        if (!texts.length) throw new Error('Nothing to add')
        if (kind === 'prompts') {
          const tx = await G.addPromptBatch(texts, imageRefs); await tx.wait()
        } else {
          const tx = await G.addAnswerBatch(texts, imageRefs); await tx.wait()
        }
      }
      toast('Cards added', 'success')
      onClose?.()
    } catch (e) {
      toast(e?.shortMessage || e?.message || 'Add failed', 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur">
      <div className="w-[720px] max-w-[94vw] rounded-2xl p-[1px] bg-gradient-to-br from-indigo-500/40 via-fuchsia-500/40 to-cyan-500/40">
        <div className="rounded-2xl bg-[#0b0e17]/95 border border-white/10 shadow-2xl">
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold tracking-tight">Admin — {kind === 'prompts' ? 'Prompts' : 'Answers'}</h3>
                <p className="text-xs text-white/60 mt-1">Add single or batch. Format batch as <code>text|imageRef</code> or <code>text</code>.</p>
              </div>
              <button onClick={onClose} className="text-white/60 hover:text-white text-sm">Close</button>
            </div>
          </div>

          <div className="p-6 space-y-4">
            <div className="inline-flex rounded-lg overflow-hidden border border-white/10">
              <button className={`px-3 py-1.5 text-sm ${mode==='single'?'bg-white/10':''}`} onClick={() => setMode('single')}>Add single</button>
              <button className={`px-3 py-1.5 text-sm ${mode==='batch'?'bg-white/10':''}`} onClick={() => setMode('batch')}>Add batch</button>
            </div>

            {mode === 'single' ? (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-sm text-white/70">Text</span>
                  <textarea rows={4} className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10"
                            value={text} onChange={e => setText(e.target.value)} />
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-sm text-white/70">imageRef</span>
                  <input className="px-3 py-2 rounded-lg bg-slate-900 border border-white/10 w-36"
                         value={img} onChange={e => setImg(e.target.value.replace(/\D/g,''))} />
                </label>
              </>
            ) : (
              <label className="flex flex-col gap-1">
                <span className="text-sm text-white/70">Batch lines</span>
                <textarea rows={10} className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10"
                          placeholder={`Text of card A|0\nFunny text line B|12\nJust text with default imageRef\n…`}
                          value={batch} onChange={e => setBatch(e.target.value)} />
              </label>
            )}
          </div>

          <div className="p-6 pt-3 border-t border-white/10 flex justify-end gap-2">
            <button className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10" onClick={onClose}>Cancel</button>
            <button className="px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500"
                    disabled={busy} onClick={submit}>
              {busy ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
