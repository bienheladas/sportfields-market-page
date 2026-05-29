import * as React from 'react'
import { useLucid } from '../lib/LucidContext'
import { useMyReservations } from '../hooks/useMyReservations'
import { ReservationCard } from '../components/ReservationCard'
import type { SlotStatus } from '../components/types'

export default function MyBookings() {
  const { connected, pkh: customerPkh } = useLucid()
  const [filter, setFilter] = React.useState<SlotStatus | 'all'>('all')

  const { slots, loading, error, reload } = useMyReservations(customerPkh)

  const filtered = filter === 'all' ? slots : slots.filter(s => s.datum.status === filter)

  // Tab counts
  const counts = {
    all:       slots.length,
    Confirmed: slots.filter(s => s.datum.status === 'Confirmed').length,
    Completed: slots.filter(s => s.datum.status === 'Completed').length,
    Disputed:  slots.filter(s => s.datum.status === 'Disputed').length,
    Refunded:  slots.filter(s => s.datum.status === 'Refunded').length,
  }

  if (!connected) return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center">
      <p className="text-[var(--muted)] mb-4">Conecta tu wallet para ver tus reservas.</p>
    </div>
  )

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-[32px] font-bold tracking-tight leading-tight">Mis reservas</h1>
          <p className="text-[var(--muted)] text-sm mt-1 max-w-lg">
            Slots confirmados on-chain. Cancelá antes del deadline, redimí tu Rent NFT en cancha, o abrí una disputa.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={reload}
            className="btn inline-flex items-center gap-2 px-3.5 py-2 rounded-[10px] border border-[var(--line-strong)] bg-[var(--paper)] text-sm font-semibold hover:border-[var(--ink-2)]"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 3.5V7H10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Actualizar
          </button>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-deep)] text-white text-sm font-semibold"
          >
            Nueva reserva
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-[var(--line)] mb-5">
        {(['all', 'Confirmed', 'Completed', 'Disputed', 'Refunded'] as const).map(tab => {
          const labels: Record<string, string> = {
            all:       'Todas',
            Confirmed: 'Confirmadas',
            Completed: 'Jugadas',
            Disputed:  'Disputas',
            Refunded:  'Reembolsadas',
          }
          const count = counts[tab as keyof typeof counts] ?? 0
          const active = filter === tab
          return (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-4 py-2.5 text-[13px] font-semibold flex items-center gap-2 border-b-2 -mb-px transition-colors ${
                active
                  ? 'border-[var(--accent)] text-[var(--ink)]'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--ink-2)]'
              }`}
            >
              {labels[tab]}
              <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
                active
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-deep)]'
                  : 'bg-[var(--paper-2)] text-[var(--ink-2)]'
              }`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="text-center py-16 text-[var(--muted)]">
          <div className="w-7 h-7 border-2 border-[var(--line)] border-t-[var(--accent)] rounded-full animate-spin mx-auto mb-3" />
          Cargando tus reservas…
        </div>
      )}

      {/* Error state */}
      {error && <p className="text-[var(--rose-ink)] text-sm mb-4">{error}</p>}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="text-center py-16 border border-dashed border-[var(--line-strong)] rounded-[14px] text-[var(--muted)]">
          <p className="text-[var(--ink)] font-semibold mb-2">
            No hay reservas{filter !== 'all' ? ` con estado "${filter}"` : ' activas'}
          </p>
          <p className="text-sm mb-5">Cuando confirmes un slot aparecerá acá.</p>
          <a
            href="/"
            className="inline-flex px-4 py-2 rounded-[10px] bg-[var(--accent)] text-white text-sm font-semibold"
          >
            Explorar canchas
          </a>
        </div>
      )}

      {/* Cards */}
      {!loading && (
        <div className="flex flex-col gap-3">
          {filtered.map(s => (
            <ReservationCard
              key={s.txHash + '#' + s.outputIndex}
              slot={s}
              onActionDone={reload}
            />
          ))}
        </div>
      )}
    </div>
  )
}
