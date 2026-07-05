// react/WeekCalendar.tsx
// Grilla 7 columnas (Lun→Dom) × 24 filas (00:00→23:00) = 168 celdas.
//
// En el nuevo diseño de linked list:
//   - open_slot_ids (del ListHead) define qué celdas son válidas esta semana
//   - available = en open_slot_ids Y sin Node UTxO → verde, clickeable
//   - Pending/Confirmed/etc = en open_slot_ids Y tiene Node → color por status
//   - (fuera de open_slot_ids) → gris, no inicializado

import * as React from 'react';
import type { RentDatum, SlotStatus, ListHeadDatum } from './types';
import { slotIdToCoord, formatAda } from './lib';
import type { RentSlotUtxo, ListHeadUtxo } from '../hooks/useRentSlots';

// Mantenemos RentSlotUtxoLike para BookingPanel y consumidores externos.
export interface RentSlotUtxoLike {
  txHash: string;
  outputIndex: number;
  datum: RentDatum;
  lovelace: bigint;
}

export interface WeekCalendarProps {
  /** ListHead del owner para esta semana. null = semana no inicializada. */
  head: ListHeadUtxo | null;
  /** Nodes activos en la lista (Pending/Confirmed/Completed/…). */
  slots: RentSlotUtxo[];
  /** slotId 1..168 actualmente seleccionado (highlight). */
  selectedSlotId?: number | null;
  /** Disparado al click en cualquier celda clickeable (available o node). */
  onSelectSlot: (slot: RentSlotUtxoLike) => void;
  /** Día de hoy (0 = Lun … 6 = Dom). Default: derivado de new Date(). */
  todayDayIndex?: number;
  /** Fecha del Lunes de la semana mostrada — sólo para el header.
   *  Default: weekStartPosix del head, o la semana en curso si no hay head. */
  weekStart?: Date;
  className?: string;
}

const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

// ───────────────────────────────────────────────────────────────────
// Virtual slot para celdas Available (sin UTxO on-chain)
// ───────────────────────────────────────────────────────────────────

function makeAvailableSlot(h: ListHeadDatum, slotId: number): RentSlotUtxoLike {
  const cfg        = h.config
  const slotStart  = cfg.weekStartPosix + (slotId - 1) * cfg.slotDurationMs
  const slotEnd    = slotStart + cfg.slotDurationMs
  const cancelDL   = slotStart - cfg.cancelDeadlineOffsetMs
  return {
    txHash: '', outputIndex: 0, lovelace: 0n,
    datum: {
      slotId, slotStart, slotEnd, cancelDeadline: cancelDL,
      rentPrice: cfg.rentPrice,
      siteCommissionBps: cfg.siteCommissionBps,
      ownerNFTName: h.ownerNFTName,
      ownerPkh:     h.ownerPkh,
      companyPkh:   h.companyPkh,
      status:       'Available',
      customerPkh:  null, rentNFTName: null, disputeDeposit: null,
      fieldName: h.fieldName, fieldAddress: h.fieldAddress,
      phone: h.phone, email: h.email, lat: h.lat, long: h.long,
      paymentAddress: h.paymentAddress,
      next: { tag: 'Empty' },
      weekEnd: cfg.weekStartPosix + 7 * 24 * 3_600_000,
      loyaltyNftsRequired: cfg.loyaltyNftsRequired ?? 5,
      guaranteePerSlot: cfg.guaranteePerSlot ?? 0n,
    },
  }
}

// ───────────────────────────────────────────────────────────────────
// Component
// ───────────────────────────────────────────────────────────────────

export function WeekCalendar({
  head,
  slots,
  selectedSlotId = null,
  onSelectSlot,
  todayDayIndex = mondayBasedDay(new Date()),
  weekStart,
  className = '',
}: WeekCalendarProps) {
  const resolvedWeekStart = weekStart
    ?? (head ? new Date(head.datum.config.weekStartPosix) : startOfWeekMonday(new Date()))

  const openIds  = React.useMemo(
    () => new Set(head?.datum.config.openSlotIds ?? []),
    [head],
  )
  const nodeById = React.useMemo(() => {
    const m = new Map<number, RentSlotUtxo>()
    for (const s of slots) m.set(s.datum.slotId, s)
    return m
  }, [slots])

  const rentPrice = head?.datum.config.rentPrice ?? 0n

  return (
    <div className={['rounded-[14px] border border-[var(--line)] bg-[var(--paper)] overflow-clip', className].join(' ')}>
      <div
        role="grid"
        aria-label="Calendario semanal de slots"
        className="grid auto-rows-[36px]"
        style={{ gridTemplateColumns: '64px repeat(7, minmax(0, 1fr))' }}
      >
        {/* ── Header row ─────────────────────────────────────── */}
        <HeaderCell />
        {DAY_LABELS.map((label, i) => (
          <DayHeader
            key={label}
            label={label}
            dayNum={new Date(resolvedWeekStart.getTime() + i * 24 * 3_600_000).getUTCDate()}
            isToday={i === todayDayIndex}
          />
        ))}

        {/* ── 24 hour rows × 7 day cols ───────────────────────── */}
        {HOURS.map((h) => (
          <React.Fragment key={h}>
            <HourCell hour={h} />
            {DAY_LABELS.map((_, day) => {
              const slotId   = day * 24 + h + 1
              const isOpen   = openIds.has(slotId)
              const node     = nodeById.get(slotId)
              const isAvail  = isOpen && !node

              const handleSelect = () => {
                if (!isOpen) return
                if (isAvail && head) {
                  onSelectSlot(makeAvailableSlot(head.datum, slotId))
                } else if (node) {
                  onSelectSlot(node)
                }
              }

              return (
                <SlotCell
                  key={slotId}
                  slotId={slotId}
                  isOpen={isOpen}
                  node={node}
                  rentPrice={rentPrice}
                  isSelected={selectedSlotId === slotId}
                  onSelect={handleSelect}
                />
              )
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────
// Cells
// ───────────────────────────────────────────────────────────────────

function HeaderCell() {
  return (
    <div className="bg-[var(--paper-2)] border-b border-r border-[var(--line)] sticky top-16 z-[5]" />
  )
}

function DayHeader({
  label, dayNum, isToday,
}: { label: string; dayNum: number; isToday: boolean }) {
  return (
    <div
      className={[
        'flex items-center justify-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider',
        'border-b border-r border-[var(--line)] last:border-r-0',
        'sticky top-16 z-[5]',
        isToday ? 'bg-[var(--ink)] text-[var(--paper)]' : 'bg-[var(--paper-2)] text-[var(--ink-2)]',
      ].join(' ')}
    >
      {label}
      <span className="font-mono font-medium text-[12px] normal-case tracking-normal opacity-70">
        {dayNum}
      </span>
    </div>
  )
}

function HourCell({ hour }: { hour: number }) {
  return (
    <div className="bg-[var(--paper)] border-b border-r border-[var(--line)] flex items-center justify-end pr-2.5 font-mono text-[11px] text-[var(--muted)] sticky left-0 z-[4]">
      {String(hour).padStart(2, '0')}:00
    </div>
  )
}

function SlotCell({
  slotId, isOpen, node, rentPrice, isSelected, onSelect,
}: {
  slotId: number
  isOpen: boolean
  node?: RentSlotUtxo
  rentPrice: bigint
  isSelected: boolean
  onSelect: () => void
}) {
  if (!isOpen) return <EmptySlot />

  const isAvailable = !node
  const status: SlotStatus = node?.datum.status ?? 'Available'
  const isClickable = true  // all open slots are clickable

  const hoverClass = isAvailable
    ? 'cursor-pointer hover:bg-[var(--mint)] hover:[outline:2px_solid_var(--accent)] hover:-outline-offset-2 hover:z-[2]'
    : status === 'Confirmed'
    ? 'cursor-pointer hover:[outline:2px_solid_#1d4ed8] hover:-outline-offset-2 hover:z-[2]'
    : status === 'Completed'
    ? 'cursor-pointer hover:[outline:2px_solid_#0f766e] hover:-outline-offset-2 hover:z-[2]'
    : status === 'Disputed'
    ? 'cursor-pointer hover:[outline:2px_solid_#b91c1c] hover:-outline-offset-2 hover:z-[2]'
    : 'cursor-not-allowed'

  const selectedClass = isSelected
    ? isAvailable   ? 'bg-[var(--accent)] text-white [outline:2px_solid_var(--ink)] -outline-offset-2 z-[3]'
    : status === 'Confirmed' ? '[outline:2px_solid_#1d4ed8] -outline-offset-2 z-[3]'
    : status === 'Completed' ? '[outline:2px_solid_#0f766e] -outline-offset-2 z-[3]'
    : status === 'Disputed'  ? '[outline:2px_solid_#b91c1c] -outline-offset-2 z-[3]'
    : ''
    : ''

  return (
    <div
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      aria-label={`Slot ${slotId} — ${isAvailable ? 'Disponible' : status}`}
      className={[
        'relative border-b border-r border-[var(--line)] last:border-r-0',
        'flex items-center justify-center text-[11px] font-semibold select-none',
        STATUS_CLASSES[status], hoverClass, selectedClass,
      ].join(' ')}
    >
      {isAvailable && (
        <span className="absolute bottom-[3px] right-1 font-mono text-[9px] font-medium opacity-70">
          {`${Number(rentPrice / 1_000_000n)}₳`}
        </span>
      )}
      {status === 'Pending' && (
        <svg className="opacity-50" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm.75 4a.75.75 0 00-1.5 0v4c0 .27.14.52.38.65l3 1.75a.75.75 0 00.74-1.3L8.75 8.57V5z"/>
        </svg>
      )}
      {status === 'Confirmed' && (
        <svg className="opacity-60" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 8a3 3 0 100-6 3 3 0 000 6zm-5 6a5 5 0 0110 0H3z"/>
        </svg>
      )}
      {status === 'Completed' && (
        <svg className="opacity-60" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8l3.5 3.5L13 4"/>
        </svg>
      )}
      {status === 'Disputed' && (
        <svg className="opacity-70" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 3a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 4zm0 7a1 1 0 110-2 1 1 0 010 2z"/>
        </svg>
      )}
    </div>
  )
}

function EmptySlot() {
  return (
    <div className="relative bg-[#e8eaed] border-b border-r border-[var(--line)] last:border-r-0 cursor-not-allowed" />
  )
}

// ───────────────────────────────────────────────────────────────────
// Status → Tailwind classes
// ───────────────────────────────────────────────────────────────────

const STATUS_CLASSES: Record<SlotStatus, string> = {
  Available:
    'bg-[var(--mint-bg)] text-[var(--mint-ink,#244d33)]',
  Pending:
    "bg-[var(--amber-bg)] text-[var(--amber-ink,#6b4d10)] bg-[image:repeating-linear-gradient(45deg,transparent_0,transparent_4px,rgba(163,124,42,0.18)_4px,rgba(163,124,42,0.18)_5px)]",
  Confirmed:
    'bg-[#dbeafe] text-[#1d4ed8]',
  Completed:
    'bg-[#ccfbf1] text-[#0f766e]',
  Disputed:
    'bg-[var(--rose-bg)] text-[var(--rose-ink,#6f2920)]',
}

// ───────────────────────────────────────────────────────────────────
// Legend
// ───────────────────────────────────────────────────────────────────

export function CalendarLegend() {
  const items: { swatch: string; label: string }[] = [
    { swatch: 'bg-[var(--mint-bg)] border-[#b9d8c1]',               label: 'Disponible'       },
    { swatch: 'bg-[var(--amber-bg)] border-[#ebd187] border-dashed', label: 'Pendiente'        },
    { swatch: 'bg-[#dbeafe] border-[#93c5fd]',                      label: 'Alquilado'        },
    { swatch: 'bg-[#ccfbf1] border-[#5eead4]',                      label: 'Jugada'           },
    { swatch: 'bg-[var(--rose-bg)] border-[#ecb5ac]',               label: 'En disputa'       },
    { swatch: 'bg-[#e8eaed] border-[#c8cacd]',                      label: 'Sin inicializar'  },
  ]
  return (
    <div className="flex flex-wrap gap-3.5 text-[12px] text-[var(--muted)]">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className={['w-3 h-3 rounded border', it.swatch].join(' ')} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────
// Date helpers
// ───────────────────────────────────────────────────────────────────

/** 0 = Lun, 6 = Dom. */
function mondayBasedDay(d: Date): number {
  return (d.getDay() + 6) % 7
}

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const dow = mondayBasedDay(x)
  x.setDate(x.getDate() - dow)
  return x
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export { mondayBasedDay, startOfWeekMonday, addDays }

export function rangeForSlot(slotId: number) {
  const { day, hour } = slotIdToCoord(slotId)
  return { day, hour, label: `${DAY_LABELS[day]} ${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00` }
}

export { formatAda }
