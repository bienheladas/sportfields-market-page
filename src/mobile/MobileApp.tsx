// MobileApp.tsx — Mejora Q: shell del modo app (nativo Capacitor, o browser con ?app=1).
// Sin react-router: onboarding si no hay wallet, y dos tabs (Redimir / Billetera) si la hay.

import * as React from 'react'
import { useLucid } from '../lib/LucidContext'
import { getSeedStorage } from '../lib/embeddedWallet'
import { Onboarding } from './Onboarding'
import { BookScreen } from './BookScreen'
import { RedeemScreen } from './RedeemScreen'
import { WalletScreen } from './WalletScreen'

type Tab = 'book' | 'redeem' | 'wallet'

export function MobileApp() {
  const { connected, connectWithSeed } = useLucid()
  const [tab, setTab] = React.useState<Tab>('redeem')
  const [restoring, setRestoring] = React.useState(true)

  // Auto-login: si hay una seed guardada (app nativa), reconectar al arrancar.
  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const storage = await getSeedStorage()
        const seed = await storage.load()
        if (seed && !cancelled) await connectWithSeed(seed)
      } catch { /* seed corrupta o inválida — cae al onboarding */ }
      if (!cancelled) setRestoring(false)
    })()
    return () => { cancelled = true }
  }, [connectWithSeed])

  if (restoring) {
    return (
      <div className="min-h-screen bg-[var(--paper)] grid place-items-center">
        <span className="text-[14px] text-[var(--muted)]">Cargando…</span>
      </div>
    )
  }

  if (!connected) return <Onboarding />

  return (
    <div className="min-h-screen bg-[var(--paper)] flex flex-col">
      <header className="sticky top-0 z-40 bg-[rgba(248,244,236,0.85)] backdrop-blur-md border-b border-[var(--line)]">
        <div className="h-14 px-5 flex items-center justify-center">
          <span className="font-bold text-[15px] tracking-[-0.01em] text-[var(--ink)]">Sportfields</span>
        </div>
      </header>

      <main className="flex-1 pb-20">
        {tab === 'book' && <BookScreen onReserved={() => setTab('redeem')} />}
        {tab === 'redeem' && <RedeemScreen />}
        {tab === 'wallet' && <WalletScreen />}
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-40 bg-[var(--paper)] border-t border-[var(--line)] flex">
        <TabButton active={tab === 'book'} onClick={() => setTab('book')} label="Reservar" glyph="＋" />
        <TabButton active={tab === 'redeem'} onClick={() => setTab('redeem')} label="Redimir" glyph="◉" />
        <TabButton active={tab === 'wallet'} onClick={() => setTab('wallet')} label="Billetera" glyph="⌬" />
      </nav>
    </div>
  )
}

function TabButton({ active, onClick, label, glyph }: {
  active: boolean; onClick: () => void; label: string; glyph: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex-1 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] flex flex-col items-center gap-0.5 text-[11px] font-semibold transition-colors',
        active ? 'text-[var(--accent)]' : 'text-[var(--muted)]',
      ].join(' ')}
    >
      <span className="text-[18px] leading-none" aria-hidden="true">{glyph}</span>
      {label}
    </button>
  )
}
