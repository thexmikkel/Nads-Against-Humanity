import React, { useEffect, useMemo, useState } from 'react'
import { toast } from '../../lib/toast.jsx'

const PAGE = 20

export default function CardsModal({ getCards }) {
  const [tab, setTab] = useState('prompts') // 'prompts' | 'answers'
  const [count, setCount] = useState(0)
  const [startId, setStartId] = useState(1)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [onlyActive, setOnlyActive] = useState(true)

  const close = () => document.getElementById('cardsModal').close()

  useEffect(() => {
    setStartId(1)
  }, [tab, onlyActive])

  useEffect(() => {
    (async () => {
      try {
        setLoading(true)
        const c = await getCards()
        if (tab === 'prompts') {
          const total = await c.promptCount()
          setCount(Number(total))
          const page = await c.pagePrompts(startId, PAGE, onlyActive)
          const out = []
          for (let i = 0; i < page.ids.length; i++) {
            out.push({
              id: Number(page.ids[i]),
              text: page.texts[i],
              img: Number(page.imageRefs[i]),
              active: page.actives[i]
            })
          }
          setRows(out)
        } else {
          const total = await c.answerCount()
          setCount(Number(total))
          const page = await c.pageAnswers(startId, PAGE, onlyActive)
          const out = []
          for (let i = 0; i < page.ids.length; i++) {
            out.push({
              id: Number(page.ids[i]),
              text: page.texts[i],
              img: Number(page.imageRefs[i]),
              active: page.actives[i]
            })
          }
          setRows(out)
        }
      } catch (e) {
        console.error(e)
        toast('Failed to load cards', 'error')
      } finally {
        setLoading(false)
      }
    })()
  }, [tab, startId, onlyActive, getCards])

  const canPrev = startId > 1
  const canNext = rows.length === PAGE && rows[rows.length - 1].id < count

  return (
    <dialog id="cardsModal" className="rounded-xl p-0 bg-slate-900 text-slate-100 w-[56rem] max-w-[92vw]">
      <div className="p-5 border-b border-slate-800 text-lg font-semibold">Cards</div>
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-slate-700 overflow-hidden">
            <button onClick={() => setTab('prompts')} className={`px-3 py-1.5 text-sm ${tab==='prompts'?'bg-slate-800':'bg-slate-900 hover:bg-slate-800'}`}>Prompts</button>
            <button onClick={() => setTab('answers')} className={`px-3 py-1.5 text-sm ${tab==='answers'?'bg-slate-800':'bg-slate-900 hover:bg-slate-800'}`}>Answers</button>
          </div>
          <label className="ml-3 text-sm inline-flex items-center gap-2">
            <input type="checkbox" checked={onlyActive} onChange={e => setOnlyActive(e.target.checked)} />
            Only active
          </label>
          <div className="ml-auto text-sm text-slate-400">Total: {count}</div>
        </div>

        <div className="border border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/40">
              <tr>
                <th className="text-left px-3 py-2 w-20">ID</th>
                <th className="text-left px-3 py-2">Text</th>
                <th className="text-left px-3 py-2 w-28">ImageRef</th>
                <th className="text-left px-3 py-2 w-24">Active</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="4" className="px-3 py-6 text-center text-slate-400">Loading…</td></tr>
              ) : rows.length ? rows.map(r => (
                <tr key={`${tab}-${r.id}`} className="border-t border-slate-800/60">
                  <td className="px-3 py-2 font-mono">{r.id}</td>
                  <td className="px-3 py-2">{r.text}</td>
                  <td className="px-3 py-2">{r.img}</td>
                  <td className="px-3 py-2">{r.active ? 'Yes' : 'No'}</td>
                </tr>
              )) : (
                <tr><td colSpan="4" className="px-3 py-6 text-center text-slate-400">No cards</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between">
          <button
            className="px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700 disabled:opacity-50"
            onClick={() => setStartId(Math.max(1, startId - PAGE))}
            disabled={!canPrev}
          >
            ← Prev
          </button>
          <div className="text-sm text-slate-400">Showing {rows.length} items starting at #{startId}</div>
          <button
            className="px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700 disabled:opacity-50"
            onClick={() => setStartId(rows.length ? rows[rows.length - 1].id + 1 : startId + PAGE)}
            disabled={!canNext}
          >
            Next →
          </button>
        </div>
      </div>
      <div className="p-5 border-t border-slate-800 flex justify-end gap-2">
        <button className="px-3 py-1.5" onClick={close}>Close</button>
      </div>
    </dialog>
  )
}
