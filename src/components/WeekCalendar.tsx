// react/WeekCalendar.tsx
// Grilla 7 columnas (Lun→Dom) × 24 filas (00:00→23:00) = 168 celdas.
// Cada celda es un RentSlotUtxo o vacía (slot no inicializado). El
// padre recibe el slot seleccionado por callback. Status mapping:
//   Available → mint, clickeable
//   Pending   → amber rayado
//   Confirmed → azul (alquilado)
//   Completed → slate
//   Disputed  → rose
//   Refunded  → muted
//   (sin datum) → vacío punteado

import * as React from 'react';
import type { RentDatum, SlotStatus } from './types';
import { slotIdToCoord, formatAda } from './lib';

// El padre nos pasa el shape que devuelve useRentSlots — no asumimos
// que es exactamente { txHash, outputIndex, datum, lovelace } por si
// cambia el hook; sólo pedimos un .datum: RentDatum.
export interface RentSlotUtxoLike {
  txHash: string;
  outputIndex: number;
  datum: RentDatum;
  lovelace: bigint;
}

export interface WeekCalendarProps {
  slots: RentSlotUtxoLike[];
  /** slotId 1..168 actualmente seleccionado (highlight). */
  selectedSlotId?: number | null;
  /** Disparado al click en una celda Available. */
  onSelectSlot: (slot: RentSlotUtxoLike) => void;
  /** Día de hoy (0 = Lun … 6 = Dom). Default: derivado de new Date(). */
  todayDayIndex?: number;
  /** Fecha del día Lun de la semana mostrada — sólo para el header.
   *  Por defecto la semana en curso. */
  weekStart?: Date;
  className?: string;
}

const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

// ───────────────────────────────────────────────────────────────────
// Component
// ───────────────────────────────────────────────────────────────────

export function WeekCalendar({
  slots,
  selectedSlotId = null,
  onSelectSlot,
  todayDayIndex = mondayBasedDay(new Date()),
  weekStart = startOfWeekMonday(new Date()),
  className = '',
}: WeekCalendarProps) {
  // Index slots by slotId → faster lookup en el render.
  const byId = React.useMemo(() => {
    const m = new Map<number, RentSlotUtxoLike>();
    for (const s of slots) m.set(s.datum.slotId, s);
    return m;
  }, [slots]);

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
            dayNum={addDays(weekStart, i).getDate()}
            isToday={i === todayDayIndex}
          />
        ))}

        {/* ── 24 hour rows × 7 day cols ───────────────────────── */}
        {HOURS.map((h) => (
          <React.Fragment key={h}>
            <HourCell hour={h} />
            {DAY_LABELS.map((_, day) => {
              const slotId = day * 24 + h + 1;
              const utxo = byId.get(slotId);
              return (
                <SlotCell
                  key={slotId}
                  slotId={slotId}
                  utxo={utxo}
                  isSelected={selectedSlotId === slotId}
                  onSelect={() => utxo && onSelectSlot(utxo)}
                />
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Cells
// ───────────────────────────────────────────────────────────────────

function HeaderCell() {
  return (
    <div className="bg-[var(--paper-2)] border-b border-r border-[var(--line)] sticky top-16 z-[5]" />
  );
}

function DayHeader({
  label,
  dayNum,
  isToday,
}: {
  label: string;
  dayNum: number;
  isToday: boolean;
}) {
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
      <span className={['font-mono font-medium text-[12px] normal-case tracking-normal', isToday ? 'opacity-70' : 'opacity-70'].join(' ')}>
        {dayNum}
      </span>
    </div>
  );
}

function HourCell({ hour }: { hour: number }) {
  return (
    <div className="bg-[var(--paper)] border-b border-r border-[var(--line)] flex items-center justify-end pr-2.5 font-mono text-[11px] text-[var(--muted)] sticky left-0 z-[4]">
      {String(hour).padStart(2, '0')}:00
    </div>
  );
}

function SlotCell({
  slotId,
  utxo,
  isSelected,
  onSelect,
}: {
  slotId: number;
  utxo?: RentSlotUtxoLike;
  isSelected: boolean;
  onSelect: () => void;
}) {
  if (!utxo) return <EmptySlot />;

  const status      = utxo.datum.status;
  const isAvailable = status === 'Available';
  const isConfirmed = status === 'Confirmed';
  const isCompleted = status === 'Completed';
  const isDisputed  = status === 'Disputed';
  const isClickable = isAvailable || isConfirmed || isCompleted || isDisputed;
  const priceLabel  = `${Number(utxo.datum.rentPrice / 1_000_000n)}₳`;

  const hoverClass = isAvailable
    ? 'cursor-pointer hover:bg-[var(--mint)] hover:[outline:2px_solid_var(--accent)] hover:-outline-offset-2 hover:z-[2]'
    : isConfirmed
    ? 'cursor-pointer hover:[outline:2px_solid_#1d4ed8] hover:-outline-offset-2 hover:z-[2]'
    : isCompleted
    ? 'cursor-pointer hover:[outline:2px_solid_#0f766e] hover:-outline-offset-2 hover:z-[2]'
    : isDisputed
    ? 'cursor-pointer hover:[outline:2px_solid_#b91c1c] hover:-outline-offset-2 hover:z-[2]'
    : 'cursor-not-allowed';

  const selectedClass = isSelected
    ? isAvailable  ? 'bg-[var(--accent)] text-white [outline:2px_solid_var(--ink)] -outline-offset-2 z-[3]'
    : isConfirmed  ? '[outline:2px_solid_#1d4ed8] -outline-offset-2 z-[3]'
    : isCompleted  ? '[outline:2px_solid_#0f766e] -outline-offset-2 z-[3]'
    : isDisputed   ? '[outline:2px_solid_#b91c1c] -outline-offset-2 z-[3]'
    : ''
    : '';

  return (
    <div
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={isClickable ? onSelect : undefined}
      onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } } : undefined}
      aria-label={`Slot ${slotId} — ${status}`}
      className={[
        'relative border-b border-r border-[var(--line)] last:border-r-0',
        'flex items-center justify-center text-[11px] font-semibold select-none',
        STATUS_CLASSES[status], hoverClass, selectedClass,
      ].join(' ')}
    >
      {isAvailable && (
        <span className="absolute bottom-[3px] right-1 font-mono text-[9px] font-medium opacity-70">
          {priceLabel}
        </span>
      )}
      {isConfirmed && (
        /* Ticket/person icon: "reservado" */
        <svg className="opacity-60" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 8a3 3 0 100-6 3 3 0 000 6zm-5 6a5 5 0 0110 0H3z"/>
        </svg>
      )}
      {isCompleted && (
        <svg className="opacity-60" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8l3.5 3.5L13 4"/>
        </svg>
      )}
      {isDisputed && (
        /* Exclamation: "en disputa" */
        <svg className="opacity-70" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 3a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 4zm0 7a1 1 0 110-2 1 1 0 010 2z"/>
        </svg>
      )}
    </div>
  );
}

function EmptySlot() {
  return (
    <div className="relative bg-[#e8eaed] border-b border-r border-[var(--line)] last:border-r-0 cursor-not-allowed" />
  );
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
  Refunded:
    'bg-[var(--paper-2)] text-[var(--muted)]',
};

// ───────────────────────────────────────────────────────────────────
// Legend (re-exportable para usar bajo el calendario)
// ───────────────────────────────────────────────────────────────────

export function CalendarLegend() {
  const items: { swatch: string; label: string }[] = [
    { swatch: 'bg-[var(--mint-bg)] border-[#b9d8c1]',              label: 'Disponible'      },
    { swatch: 'bg-[var(--amber-bg)] border-[#ebd187] border-dashed', label: 'Pendiente'      },
    { swatch: 'bg-[#dbeafe] border-[#93c5fd]',                     label: 'Alquilado'       },
    { swatch: 'bg-[#ccfbf1] border-[#5eead4]',                     label: 'Jugada'          },
    { swatch: 'bg-[var(--rose-bg)] border-[#ecb5ac]',              label: 'En disputa'      },
    { swatch: 'bg-[#e8eaed] border-[#c8cacd]',                     label: 'Sin inicializar' },
  ];
  return (
    <div className="flex flex-wrap gap-3.5 text-[12px] text-[var(--muted)]">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className={['w-3 h-3 rounded border', it.swatch].join(' ')} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Date helpers (local, sin libs)
// ───────────────────────────────────────────────────────────────────

/** 0 = Lun, 6 = Dom. */
function mondayBasedDay(d: Date): number {
  return (d.getDay() + 6) % 7;
}

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = mondayBasedDay(x);
  x.setDate(x.getDate() - dow);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// Suppress unused: helpers exported / used internally only.
// Re-export for tests / consumers wanting the same week math.
export { mondayBasedDay, startOfWeekMonday, addDays };

// (Not used here but commonly handy alongside this component.)
export function rangeForSlot(slotId: number) {
  const { day, hour } = slotIdToCoord(slotId);
  return { day, hour, label: `${DAY_LABELS[day]} ${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00` };
}

// Re-export formatAda en caso de que el consumidor lo pida desde acá.
export { formatAda };
