import React, { useEffect, useState } from 'react'

const listeners = new Set()
export function toast(message, type='info') {
  listeners.forEach(fn => fn({ message, type, id: Math.random().toString(16).slice(2) }))
}

export function ToastHost() {
  const [items, setItems] = useState([])
  useEffect(() => {
    const add = (t) => {
      setItems(prev => [...prev, t])
      setTimeout(() => setItems(prev => prev.filter(x => x.id !== t.id)), t.type==='error'?7000:t.type==='loading'?3000:3500)
    }
    listeners.add(add)
    return () => listeners.delete(add)
  }, [])
  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2">
      {items.map(t => (
        <div key={t.id} className={`toast text-sm px-3 py-2 rounded-md ${
          t.type==='error' ? 'bg-red-600' :
          t.type==='success' ? 'bg-emerald-600' :
          t.type==='loading' ? 'bg-slate-700' : 'bg-slate-800'
        }`}>
          {t.message}
        </div>
      ))}
    </div>
  )
}
