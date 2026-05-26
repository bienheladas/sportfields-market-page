// SlotFilterBar.tsx
// Hero search bar para FieldDiscovery — selector de día (Lun–Dom) y
// franja horaria (00–23) + botón "Buscar". Estado controlado por el
// padre.

import * as React from 'react';

export type DayKey = 'lun' | 'mar' | 'mie' | 'jue' | 'vie' | 'sab' | 'dom';

export interface SlotFilter {
  day: DayKey | null;
  hour: number | null;
}

export interface SlotFilterBarProps {
  value: SlotFilter;
  onChange: (next: SlotFilter) => void;
  onSearch?: () => void;
  className?: string;
}

const DAYS: { k: DayKey; label: string }[] = [
  { k: 'lun', label: 'Lun' },
  { k: 'mar', label: 'Mar' },
  { k: 'mie', label: 'Mié' },
  { k: 'jue', label: 'Jue' },
  { k: 'vie', label: 'Vie' },
  { k: 'sab', label: 'Sáb' },
  { k: 'dom', label: 'Dom' },
];

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function SlotFilterBar({ value, onChange, onSearch, className = '' }: SlotFilterBarProps) {
  const [open, setOpen] = React.useState<'day' | 'hour' | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const dayLabel = value.day ? DAYS.find((d) => d.k === value.day)!.label : 'Cualquier día';
  const hourLabel =
    value.hour == null
      ? 'Cualquier hora'
      : `${pad(value.hour)}:00 – ${pad((value.hour + 1) % 24)}:00`;

  const setDay = (d: DayKey | null) => { onChange({ ...value, day: d }); setOpen(null); };
  const setHour = (h: number | null) => { onChange({ ...value, hour: h }); setOpen(null); };

  return (
    <div
      ref={rootRef}
      className={[
        'flex items-stretch gap-1.5 p-1.5',
        'bg-[var(--paper)] border border-[var(--line-strong)] rounded-2xl',
        'shadow-[0_1px_2px_rgba(20,16,8,.04),0_6px_18px_rgba(20,16,8,.06)]',
        'max-w-[720px]',
        'max-md:flex-col',
        className,
      ].join(' ')}
    >
      <FilterCell
        label="Día"
        value={dayLabel}
        isPlaceholder={value.day == null}
        isOpen={open === 'day'}
        onToggle={() => setOpen(open === 'day' ? null : 'day')}
        onClear={value.day ? () => setDay(null) : undefined}
        popover={
          <div className="min-w-[280px]">
            <PopoverHeader>Elegí un día</PopoverHeader>
            <div className="grid grid-cols-7 gap-1">
              {DAYS.map((d) => (
                <button
                  key={d.k}
                  type="button"
                  onClick={() => setDay(value.day === d.k ? null : d.k)}
                  className={[
                    'py-2.5 rounded-md text-[12px] font-semibold tracking-wider uppercase border transition-colors',
                    value.day === d.k
                      ? 'bg-[var(--ink)] border-[var(--ink)] text-[var(--paper)]'
                      : 'bg-[var(--paper)] border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--ink-2)]',
                  ].join(' ')}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <FilterCell
        label="Hora"
        value={hourLabel}
        isPlaceholder={value.hour == null}
        isOpen={open === 'hour'}
        onToggle={() => setOpen(open === 'hour' ? null : 'hour')}
        onClear={value.hour != null ? () => setHour(null) : undefined}
        popover={
          <div className="min-w-[320px]">
            <PopoverHeader>Franja horaria</PopoverHeader>
            <div className="grid grid-cols-6 gap-1">
              {HOURS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHour(value.hour === h ? null : h)}
                  className={[
                    'py-1.5 rounded-md text-[11px] font-mono font-medium border transition-colors',
                    value.hour === h
                      ? 'bg-[var(--ink)] border-[var(--ink)] text-[var(--paper)]'
                      : 'bg-[var(--paper)] border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--ink-2)]',
                  ].join(' ')}
                >
                  {pad(h)}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <button
        type="button"
        onClick={onSearch}
        className={[
          'flex items-center justify-center gap-2 px-6 rounded-[11px]',
          'bg-[var(--accent)] text-white font-semibold text-[15px]',
          'hover:bg-[var(--accent-deep)] active:translate-y-[1px] transition-all',
          'max-md:py-3.5',
        ].join(' ')}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.7" />
          <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        Buscar
      </button>
    </div>
  );
}

function FilterCell({
  label, value, isPlaceholder, isOpen, onToggle, onClear, popover,
}: {
  label: string; value: string; isPlaceholder: boolean; isOpen: boolean;
  onToggle: () => void; onClear?: () => void; popover: React.ReactNode;
}) {
  return (
    <div className="relative flex-1 min-w-0">
      <button
        type="button"
        onClick={onToggle}
        className={[
          'w-full text-left px-4 pt-2.5 pb-3 rounded-[11px] transition-colors',
          'hover:bg-[var(--paper-2)]',
          isOpen ? 'bg-[var(--paper-2)] shadow-[inset_0_0_0_1px_var(--line-strong)]' : '',
        ].join(' ')}
      >
        <span className="block text-[11px] uppercase tracking-[0.08em] text-[var(--muted)] font-semibold">
          {label}
        </span>
        <span className={['mt-1 block text-[15px] truncate', isPlaceholder ? 'text-[var(--muted)] font-normal' : 'text-[var(--ink)] font-medium'].join(' ')}>
          {value}
        </span>
      </button>

      {onClear && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClear(); }}
          aria-label={`Limpiar ${label.toLowerCase()}`}
          className="absolute top-1/2 right-3 -translate-y-1/2 w-5 h-5 rounded-full bg-[var(--line)] hover:bg-[var(--line-strong)] text-[var(--ink)] text-[11px] grid place-items-center"
        >
          ×
        </button>
      )}

      {isOpen && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute top-[calc(100%+10px)] left-0 z-30 p-4 bg-[var(--paper)] border border-[var(--line-strong)] rounded-2xl shadow-[0_1px_2px_rgba(20,16,8,.04),0_6px_18px_rgba(20,16,8,.06)]"
        >
          {popover}
        </div>
      )}
    </div>
  );
}

function PopoverHeader({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="m-0 mb-3 text-[11px] uppercase tracking-[0.08em] text-[var(--muted)] font-semibold">
      {children}
    </h4>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
