// src/components/modals/CardsModal.jsx
import React, { useEffect, useState } from 'react'

const PAGE = 24

export default function CardsModal({ getCards }) {
  const [tab, setTab] = useState('prompts') // 'prompts' | 'answers'
  const [rows, setRows] = useState([])      // string[] (text only)
  const [startId, setStartId] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const close = () => document.getElementById('cardsModal')?.close()

  async function loadPage(kind = tab, start = startId) {
    try {
      setLoading(true)
      setErr('')
      const C = await getCards()
      if (!C) throw new Error('Cards contract not ready')

      let count = 0
      if (kind === 'prompts') {
        count = Number(await C.promptCount())
        const res = await C.pagePrompts(start, PAGE, true) // onlyActive = true
        const texts = Array.from(res[1] || [])
        const actives = Array.from(res[3] || []).map(Boolean)
        // keep only active, sort alpha
        const filtered = texts.filter((_, i) => actives[i]).sort((a, b) =>
          String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' })
        )
        setRows(filtered)
      } else {
        count = Number(await C.answerCount())
        const res = await C.pageAnswers(start, PAGE, true)
        const texts = Array.from(res[1] || [])
        const actives = Array.from(res[3] || []).map(Boolean)
        const filtered = texts.filter((_, i) => actives[i]).sort((a, b) =>
          String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' })
        )
        setRows(filtered)
      }
      setTotal(count)
    } catch (e) {
      setRows([])
      setErr(e?.message || 'Failed to load cards')
    } finally {
      setLoading(false)
    }
  }

  // initial + when tab/startId changes
  useEffect(() => { loadPage(tab, startId) }, [tab, startId])

  const canPrev = startId > 1
  const canNext = startId + PAGE <= total

  return (
    <dialog id="cardsModal" className="rounded-xl p-0 bg-slate-900 text-slate-100 w-[56rem] max-w-[92vw]">
      <div className="p-5 border-b border-slate-800 text-lg font-semibold">Cards</div>

      <div className="p-5 space-y-4">
        {/* Tabs */}
        <div className="inline-flex rounded-md border border-slate-700 overflow-hidden">
          <button
            onClick={() => { setTab('prompts'); setStartId(1) }}
            className={`px-3 py-1.5 text-sm ${tab==='prompts'?'bg-slate-800':'bg-slate-900 hover:bg-slate-800'}`}
          >
            Prompts
          </button>
          <button
            onClick={() => { setTab('answers'); setStartId(1) }}
            className={`px-3 py-1.5 text-sm ${tab==='answers'?'bg-slate-800':'bg-slate-900 hover:bg-slate-800'}`}
          >
            Answers
          </button>
        </div>

        {/* List */}
        <div className="rounded-lg border border-slate-800">
          {loading ? (
            <div className="p-6 text-center text-slate-400 text-sm">Loading…</div>
          ) : err ? (
            <div className="p-6 text-center text-rose-300 text-sm">{err}</div>
          ) : rows.length ? (
            <ul className="divide-y divide-slate-800">
              {rows.map((t, i) => (
                <li key={`${tab}-${startId}-${i}`} className="p-3 text-sm whitespace-pre-wrap leading-relaxed">
                  {t || <i className="text-slate-500">(empty)</i>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-6 text-center text-slate-400 text-sm">No cards on this page</div>
          )}
        </div>

        {/* Pager + Close */}
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-500">
            {total ? `Showing ${startId}–${Math.min(startId + PAGE - 1, total)} of ${total}` : ''}
          </div>
          <div className="flex gap-2">
            <button
              className="px-3 py-1.5 rounded-md bg-slate-800 disabled:opacity-50"
              onClick={() => canPrev && setStartId(Math.max(1, startId - PAGE))}
              disabled={!canPrev || loading}
            >
              Prev
            </button>
            <button
              className="px-3 py-1.5 rounded-md bg-slate-800 disabled:opacity-50"
              onClick={() => canNext && setStartId(startId + PAGE)}
              disabled={!canNext || loading}
            >
              Next
            </button>
            <button className="px-3 py-1.5 rounded-md bg-slate-700" onClick={close}>
              Close
            </button>
          </div>
        </div>
      </div>
    </dialog>
  )
}
