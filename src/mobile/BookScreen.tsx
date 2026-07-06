// BookScreen.tsx — Mejora Q (modo app): reservar una cancha con la wallet embebida.
// Usa el alquiler directo (M2): Confirmed + Rent NFT + 100% del precio en una sola tx
// (useReserveSlot, el mismo hook de la web). Disponible = openSlotIds de cada semana
// activa menos los slots ya ocupados (nodos de esa semana) y los que ya empezaron.

import * as React from 'react'
import { useRentSlots, type ListHeadUtxo } from '../hooks/useRentSlots'
import { useReserveSlot } from '../hooks/useReserveSlot'
import { decodeBBS, formatAda, slotIdToCoord } from '../components/lib'

const DAYS_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const WEEK_MS = 7 * 24 * 3_600_000
// on-chain: la reserva exige validTo < slot_start − 60 s; margen extra para construir/firmar
const RESERVE_CUTOFF_MS = 120_000

interface FieldGroup {
  ownerNFTName: string
  fieldName: string
  fieldAddress: string
  weeks: ListHeadUtxo[]
}

export function BookScreen({ onReserved }: { onReserved: () => void }) {
  const { slots, heads, loading, error, reload } = useRentSlots()
  const [selectedField, setSelectedField] = React.useState<string | null>(null)

  const now = Date.now()

  const groups = React.useMemo(() => {
    const gs: FieldGroup[] = []
    for (const h of heads) {
      if (h.datum.config.weekStartPosix + WEEK_MS <= now) continue  // semana ya terminada
      let g = gs.find(x => x.ownerNFTName === h.datum.ownerNFTName)
      if (!g) {
        g = {
          ownerNFTName: h.datum.ownerNFTName,
          fieldName: decodeBBS(h.datum.fieldName),
          fieldAddress: decodeBBS(h.datum.fieldAddress),
          weeks: [],
        }
        gs.push(g)
      }
      g.weeks.push(h)
    }
    for (const g of gs) g.weeks.sort((a, b) => a.datum.config.weekStartPosix - b.datum.config.weekStartPosix)
    return gs
  }, [heads, now])

  const availableSlotIds = React.useCallback((head: ListHeadUtxo): number[] => {
    const cfg = head.datum.config
    const weekEnd = cfg.weekStartPosix + WEEK_MS
    const occupied = new Set(
      slots
        .filter(s => s.datum.ownerNFTName === head.datum.ownerNFTName && s.datum.weekEnd === weekEnd)
        .map(s => s.datum.slotId),
    )
    return cfg.openSlotIds.filter(id => {
      if (occupied.has(id)) return false
      const slotStart = cfg.weekStartPosix + (id - 1) * cfg.slotDurationMs
      return slotStart > now + RESERVE_CUTOFF_MS
    })
  }, [slots, now])

  const selected = groups.find(g => g.ownerNFTName === selectedField) ?? null

  return (
    <div className="flex flex-col gap-3 px-5 py-6 max-w-[440px] w-full mx-auto">
      <div className="flex items-baseline justify-between">
        <h2 className="m-0 text-[17px] font-semibold text-[var(--ink)]">
          {selected ? selected.fieldName : 'Reservar cancha'}
        </h2>
        {selected ? (
          <button
            type="button"
            onClick={() => setSelectedField(null)}
            className="text-[13px] font-medium text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
          >
            ← Canchas
          </button>
        ) : (
          <button
            type="button"
            onClick={reload}
            className="text-[13px] font-medium text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
          >
            Actualizar
          </button>
        )}
      </div>

      {loading && <p className="m-0 py-8 text-center text-[14px] text-[var(--muted)]">Cargando canchas…</p>}

      {error && (
        <div role="alert" className="px-3.5 py-2.5 rounded-xl bg-[var(--rose-bg)] border border-[#ecb5ac] text-[13px] text-[var(--rose-ink)]">
          No se pudieron cargar las canchas. <button type="button" onClick={reload} className="underline font-semibold">Reintentar</button>
        </div>
      )}

      {!loading && !error && !selected && groups.length === 0 && (
        <p className="m-0 py-10 text-center text-[14px] text-[var(--muted)]">
          No hay canchas con semanas programadas ahora mismo.
        </p>
      )}

      {!loading && !selected && groups.map(g => {
        const totalAvailable = g.weeks.reduce((n, w) => n + availableSlotIds(w).length, 0)
        const price = g.weeks[0].datum.config.rentPrice
        return (
          <button
            key={g.ownerNFTName}
            type="button"
            onClick={() => setSelectedField(g.ownerNFTName)}
            disabled={totalAvailable === 0}
            className="w-full text-left p-4 rounded-2xl bg-[var(--paper-2)] border border-[var(--line)] hover:border-[var(--line-strong)] transition-colors disabled:opacity-50"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="block text-[15px] font-semibold text-[var(--ink)] truncate">{g.fieldName}</span>
                <span className="block mt-0.5 text-[12px] text-[var(--muted)] truncate">{g.fieldAddress}</span>
              </div>
              <span className="shrink-0 text-[13px] font-semibold text-[var(--ink)]">{formatAda(price)}/h</span>
            </div>
            <span className="block mt-2 text-[12px] text-[var(--muted)]">
              {totalAvailable === 0 ? 'Sin horarios disponibles' : `${totalAvailable} horarios disponibles`}
            </span>
          </button>
        )
      })}

      {selected && selected.weeks.map(week => (
        <WeekSlots
          key={`${week.txHash}#${week.outputIndex}`}
          head={week}
          availableIds={availableSlotIds(week)}
          onReserved={onReserved}
        />
      ))}
    </div>
  )
}

function WeekSlots({ head, availableIds, onReserved }: {
  head: ListHeadUtxo
  availableIds: number[]
  onReserved: () => void
}) {
  const { reserve, loading } = useReserveSlot()
  const [chosen, setChosen] = React.useState<number | null>(null)
  const [txHash, setTxHash] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const cfg = head.datum.config
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone

  // Agrupar los slots disponibles por día de la semana
  const byDay = React.useMemo(() => {
    const m = new Map<number, number[]>()
    for (const id of availableIds) {
      const { day } = slotIdToCoord(id)
      if (!m.has(day)) m.set(day, [])
      m.get(day)!.push(id)
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [availableIds])

  const weekLabel = new Date(cfg.weekStartPosix).toLocaleDateString('es-AR', {
    timeZone: deviceTz, day: 'numeric', month: 'short',
  })

  const handleReserve = async () => {
    if (chosen === null) return
    setError(null)
    try {
      const hash = await reserve(head, chosen)
      setTxHash(hash)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (txHash) {
    return (
      <div className="p-4 rounded-2xl bg-[#eaf4ee] border border-[#bcd9c6]">
        <p className="m-0 text-[14px] font-semibold text-[#244d33]">✓ Reserva confirmada y pagada</p>
        <p className="m-0 mt-1 text-[12px] leading-[1.5] text-[#3c6a4d]">
          Aparecerá en la pestaña Redimir en ~1 minuto (confirmación en cadena).
        </p>
        <code className="block mt-2 px-2.5 py-1.5 rounded-lg bg-white/60 text-[11px] break-all text-[#244d33]">{txHash}</code>
        <button
          type="button"
          onClick={onReserved}
          className="mt-3 w-full py-2 rounded-xl bg-[var(--paper)] border border-[#bcd9c6] text-[#244d33] text-[13px] font-semibold"
        >
          Ver mis reservas
        </button>
      </div>
    )
  }

  if (availableIds.length === 0) return null

  return (
    <section className="p-4 rounded-2xl bg-[var(--paper-2)] border border-[var(--line)] flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="m-0 text-[14px] font-semibold text-[var(--ink)]">Semana del {weekLabel}</h3>
        <span className="text-[13px] font-semibold text-[var(--ink)]">{formatAda(cfg.rentPrice)}/h</span>
      </div>

      {byDay.map(([day, ids]) => (
        <div key={day}>
          <span className="block mb-1.5 text-[12px] font-semibold text-[var(--muted)]">{DAYS_ES[day]}</span>
          <div className="flex flex-wrap gap-1.5">
            {ids.map(id => {
              const { hour } = slotIdToCoord(id)
              const active = chosen === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setChosen(active ? null : id)}
                  className={[
                    'px-3 py-1.5 rounded-lg text-[13px] font-semibold tabular-nums border transition-colors',
                    active
                      ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                      : 'bg-[var(--paper)] border-[var(--line)] text-[var(--ink)] hover:border-[var(--line-strong)]',
                  ].join(' ')}
                >
                  {String(hour).padStart(2, '0')}:00
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {error && (
        <div role="alert" className="px-3 py-2 rounded-xl bg-[var(--rose-bg)] border border-[#ecb5ac] text-[12px] leading-[1.45] text-[var(--rose-ink)] break-words">
          {error}
        </div>
      )}

      {chosen !== null && (
        <button
          type="button"
          disabled={loading}
          onClick={handleReserve}
          className="w-full py-2.5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-deep)] text-white text-[14px] font-semibold transition-colors disabled:opacity-50"
        >
          {loading
            ? 'Firmando y enviando…'
            : `Reservar ${DAYS_ES[slotIdToCoord(chosen).day]} ${String(slotIdToCoord(chosen).hour).padStart(2, '0')}:00 — pagar ${formatAda(cfg.rentPrice)}`}
        </button>
      )}
    </section>
  )
}
