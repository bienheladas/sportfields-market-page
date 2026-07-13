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

  if (restoring) return <SplashScreen />
  if (!connected) return <Onboarding />

  return (
    <div className="min-h-screen bg-[var(--paper)] flex flex-col">
      <header className="sticky top-0 z-40 bg-[rgba(248,244,236,0.85)] backdrop-blur-md border-b border-[var(--line)]">
        <div className="h-14 px-5 flex items-center justify-center">
          <span className="font-bold text-[15px] tracking-[-0.02em] text-[var(--ink)]">separatucancha</span>
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

function SplashScreen() {
  const [dotOpacity, setDotOpacity] = React.useState([0.22, 0.22, 0.22])

  React.useEffect(() => {
    let frame = 0
    const DELAYS = [0, 4, 8]  // stagger in animation frames (~150ms each)
    const id = setInterval(() => {
      frame++
      setDotOpacity(DELAYS.map(d => {
        const t = ((frame + d) % 12) / 12
        return t < 0.4 ? 0.22 + (1 - 0.22) * (t / 0.4) : 0.22 + (1 - 0.22) * Math.max(0, (1 - t) / 0.6)
      }))
    }, 108)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-[22px] bg-[#f8f4ec]">
      <svg viewBox="0 0 48 48" width="84" height="84" fill="none"
        stroke="#ff6a4d" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <rect x="7" y="7" width="34" height="34" rx="7"/>
        <line x1="24" y1="7" x2="24" y2="41"/>
        <circle cx="24" cy="24" r="7"/>
      </svg>
      <div style={{ fontWeight: 800, letterSpacing: '-0.03em', fontSize: 26, color: '#1a1a17' }}>
        separatucancha
      </div>
      <div className="flex gap-[7px] mt-1">
        {dotOpacity.map((op, i) => (
          <span key={i} style={{
            width: 7, height: 7, borderRadius: '50%',
            background: '#ff6a4d', opacity: op,
            display: 'inline-block',
          }} />
        ))}
      </div>
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
