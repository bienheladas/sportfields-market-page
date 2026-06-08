// FieldDiscovery.tsx — Landing page (route "/")
// Lee RentDatum[] desde useRentSlots(), agrupa por ownerNFTName y
// renderiza una FieldCard por cada cancha.

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import type { RentDatum, ListHeadDatum, FieldSummary } from '../components/types';
import { useRentSlots } from '../hooks/useRentSlots';
import type { ListHeadUtxo } from '../hooks/useRentSlots';
import { decodeBBS, slotIdToCoord } from '../components/lib';
import { SlotFilterBar, type SlotFilter, type DayKey } from '../components/SlotFilterBar';
import { FieldCard } from '../components/FieldCard';

// ── Aggregation ────────────────────────────────────────────────────

const DAY_INDEX: Record<DayKey, number> = {
  lun: 0, mar: 1, mie: 2, jue: 3, vie: 4, sab: 5, dom: 6,
};

function slotMatchesFilter(slotId: number, filter: SlotFilter): boolean {
  if (filter.day == null && filter.hour == null) return true;
  const { day, hour } = slotIdToCoord(slotId);
  if (filter.day != null && day !== DAY_INDEX[filter.day]) return false;
  if (filter.hour != null && hour !== filter.hour) return false;
  return true;
}

export function groupBySummary(slots: RentDatum[], headUtxos: ListHeadUtxo[], filter: SlotFilter): FieldSummary[] {
  // Deduplicate heads by txHash (protects against double init-week runs)
  const seen = new Set<string>();
  const heads = headUtxos.filter(u => {
    if (seen.has(u.txHash)) return false;
    seen.add(u.txHash);
    return true;
  });

  // Build set of taken slot IDs per owner (across all weeks — for the card count)
  const takenByOwner = new Map<string, Set<number>>();
  for (const s of slots) {
    let set = takenByOwner.get(s.ownerNFTName);
    if (!set) { set = new Set(); takenByOwner.set(s.ownerNFTName, set); }
    set.add(s.slotId);
  }

  // One entry per ListHead (one active week per owner)
  return heads.map(u => {
    const h = u.datum;
    const taken = takenByOwner.get(h.ownerNFTName) ?? new Set<number>();
    const slotsAvailable = h.config.openSlotIds.filter(
      id => !taken.has(id) && slotMatchesFilter(id, filter)
    ).length;
    return {
      ownerNFTName: h.ownerNFTName,
      fieldName: h.fieldName,
      fieldAddress: h.fieldAddress,
      phone: h.phone,
      email: h.email,
      lat: h.lat,
      long: h.long,
      rentPrice: h.config.rentPrice,
      slotsAvailable,
      weekStartPosix: h.config.weekStartPosix,
      headTxHash: u.txHash,
    };
  }).sort((a, b) => {
    if (b.slotsAvailable !== a.slotsAvailable) return b.slotsAvailable - a.slotsAvailable;
    return decodeBBS(a.fieldName).localeCompare(decodeBBS(b.fieldName));
  });
}

// ── Page ──────────────────────────────────────────────────────────

export default function FieldDiscovery() {
  const navigate = useNavigate();
  const { slots: utxos, heads: headUtxos, loading, error } = useRentSlots();

  const datums = React.useMemo(() => utxos.map(u => u.datum), [utxos]);
  const [filter, setFilter] = React.useState<SlotFilter>({ day: null, hour: null });

  const fields = React.useMemo<FieldSummary[]>(
    () => groupBySummary(datums, headUtxos, filter),
    [datums, headUtxos, filter],
  );

  const hasActiveFilter = filter.day != null || filter.hour != null;
  const visible = hasActiveFilter ? fields.filter((f) => f.slotsAvailable > 0) : fields;
  const totalAvailable = fields.reduce((s, f) => s + f.slotsAvailable, 0);
  const visibleAvailable = visible.reduce((s, f) => s + f.slotsAvailable, 0);

  const goToField = (ownerNFTName: string, fieldName: string, weekStartPosix?: number) => {
    const ws = weekStartPosix != null ? `&ws=${weekStartPosix}` : '';
    navigate(`/field/${ownerNFTName}?fn=${fieldName}${ws}`);
  };
  const gridRef = React.useRef<HTMLDivElement>(null);
  const scrollToGrid = () => gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      {/* ── Hero ── */}
      <section className="max-w-[1280px] mx-auto px-8 max-sm:px-[18px] pt-16 pb-9">
        <span className="inline-flex items-center gap-2 pl-2 pr-3 py-1 mb-[22px] rounded-full bg-[var(--paper-2)] border border-[var(--line)] text-[12px] font-semibold text-[var(--ink-2)]">
          <span className="w-[7px] h-[7px] rounded-full bg-[var(--mint-deep)] shadow-[0_0_0_3px_rgba(77,150,105,.22)] animate-pulse" />
          Cardano Preview · Reservas on-chain
        </span>

        <h1 className="m-0 mb-[18px] text-[clamp(40px,5.6vw,64px)] leading-[1.02] tracking-[-0.028em] font-bold max-w-[820px] text-balance">
          Reserva tu{' '}
          <span className="text-[var(--accent)] whitespace-nowrap">cancha deportiva</span>
        </h1>

        <p className="m-0 mb-8 text-[17px] leading-[1.55] text-[var(--muted)] max-w-[560px]">
          Pagos on-chain<Sep />Sin intermediarios<Sep />Confirmación inmediata
        </p>

        <SlotFilterBar value={filter} onChange={setFilter} onSearch={scrollToGrid} />
      </section>

      {/* ── Listings ── */}
      <section ref={gridRef} className="max-w-[1280px] mx-auto px-8 max-sm:px-[18px] pt-7 pb-20">
        <ListingsHeader loading={loading} count={visible.length} totalSlots={visibleAvailable || totalAvailable} />
        <ActiveFilters filter={filter} onChange={setFilter} />

        {error ? (
          <ErrorState message={error} />
        ) : loading ? (
          <SkeletonGrid />
        ) : visible.length === 0 ? (
          <EmptyState hasActiveFilter={hasActiveFilter} onClear={() => setFilter({ day: null, hour: null })} />
        ) : (
          <div className="grid grid-cols-3 max-lg:grid-cols-2 max-sm:grid-cols-1 gap-[22px] max-lg:gap-[18px]">
            {visible.map((f) => (
              <FieldCard key={f.headTxHash ?? f.ownerNFTName + (f.weekStartPosix ?? '')} field={f} onOpen={goToField} />
            ))}
          </div>
        )}

        <OwnerCta onClick={() => navigate('/register')} />
      </section>
    </main>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────

function Sep() {
  return <span className="text-[var(--line-strong)] mx-2">·</span>;
}

function ListingsHeader({ loading, count, totalSlots }: { loading: boolean; count: number; totalSlots: number }) {
  return (
    <header className="flex flex-wrap items-baseline gap-4 mb-[22px]">
      <h2 className="m-0 text-[22px] font-semibold tracking-[-0.015em]">
        {loading
          ? <><strong className="font-bold">—</strong> canchas disponibles</>
          : <><strong className="font-bold">{count}</strong> canchas disponibles</>
        }
      </h2>
      <span className="text-[13px] text-[var(--muted)]">
        {loading ? 'cargando datos on-chain…' : (
          <><span className="font-mono font-medium text-[var(--ink-2)]">{totalSlots}</span> slots libres esta semana</>
        )}
      </span>
      <span className="flex-1" />
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[13px] text-[var(--ink-2)]">
        Ordenar por: <strong className="font-semibold ml-1">más slots disponibles</strong>
      </span>
    </header>
  );
}

function ActiveFilters({ filter, onChange }: { filter: SlotFilter; onChange: (next: SlotFilter) => void }) {
  const DAY_LABELS: Record<DayKey, string> = { lun: 'Lun', mar: 'Mar', mie: 'Mié', jue: 'Jue', vie: 'Vie', sab: 'Sáb', dom: 'Dom' };
  const chips: React.ReactNode[] = [];

  if (filter.day) {
    chips.push(
      <FilterChip key="day" onClear={() => onChange({ ...filter, day: null })}>
        Día: {DAY_LABELS[filter.day]}
      </FilterChip>,
    );
  }
  if (filter.hour != null) {
    const h = String(filter.hour).padStart(2, '0');
    const h2 = String((filter.hour + 1) % 24).padStart(2, '0');
    chips.push(
      <FilterChip key="hour" onClear={() => onChange({ ...filter, hour: null })}>
        Hora: {h}:00 – {h2}:00
      </FilterChip>,
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mb-[22px] min-h-[32px]">
      {chips}
      {chips.length > 0 && (
        <button
          type="button"
          onClick={() => onChange({ day: null, hour: null })}
          className="bg-transparent border-0 text-[12px] text-[var(--muted)] underline cursor-pointer px-1.5 py-1"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}

function FilterChip({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full bg-[var(--ink)] text-[var(--paper)] text-[12px] font-medium">
      {children}
      <button
        type="button"
        onClick={onClear}
        className="w-[18px] h-[18px] grid place-items-center rounded-full bg-white/15 hover:bg-white/25 text-[10px]"
        aria-label="Quitar filtro"
      >
        ×
      </button>
    </span>
  );
}

function SkeletonGrid() {
  const shimmer = 'bg-[linear-gradient(90deg,var(--paper-2)_0%,var(--paper-3)_50%,var(--paper-2)_100%)] [background-size:200%_100%] animate-[fc-shimmer_1.4s_ease-in-out_infinite]';
  return (
    <>
      <style>{`@keyframes fc-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      <div className="grid grid-cols-3 max-lg:grid-cols-2 max-sm:grid-cols-1 gap-[22px] max-lg:gap-[18px]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-[var(--paper)] border border-[var(--line)] rounded-[14px] overflow-hidden">
            <div className={`aspect-[16/10] ${shimmer}`} />
            <div className="p-[18px] flex flex-col gap-2.5">
              <div className={`h-[22px] w-[70%] rounded ${shimmer}`} />
              <div className={`h-3 w-[50%] rounded ${shimmer}`} />
              <div className="h-px bg-[var(--line)] my-2" />
              <div className="flex justify-between">
                <div className={`h-[22px] w-[40%] rounded ${shimmer}`} />
                <div className={`h-6 w-[40%] rounded-full ${shimmer}`} />
              </div>
              <div className={`h-[42px] rounded-[10px] mt-1.5 ${shimmer}`} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function EmptyState({ hasActiveFilter, onClear }: { hasActiveFilter: boolean; onClear: () => void }) {
  return (
    <div className="py-[72px] px-7 text-center border border-dashed border-[var(--line-strong)] rounded-[14px] bg-[var(--paper)]">
      <div className="w-28 h-28 mx-auto mb-[22px] rounded-full bg-[var(--paper-2)] grid place-items-center">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="text-[var(--muted)]">
          <circle cx="24" cy="24" r="18" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 3" />
          <path d="M16 28c2 2 5 3 8 3s6-1 8-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="19" cy="20" r="1.4" fill="currentColor" />
          <circle cx="29" cy="20" r="1.4" fill="currentColor" />
        </svg>
      </div>
      <h3 className="m-0 mb-2 text-lg font-semibold">
        {hasActiveFilter ? 'No hay canchas disponibles para este horario' : 'Todavía no hay canchas registradas'}
      </h3>
      <p className="m-0 mx-auto mb-5 text-sm text-[var(--muted)] max-w-[380px] leading-[1.5]">
        {hasActiveFilter
          ? 'Prueba con otro día o franja horaria, o limpia los filtros para ver todas las canchas.'
          : 'Sé el primero en registrar tu cancha en Sportfields.'}
      </p>
      {hasActiveFilter && (
        <button
          type="button"
          onClick={onClear}
          className="bg-transparent border border-[var(--line-strong)] hover:border-[var(--ink)] text-[var(--ink)] rounded-[10px] px-4 py-[9px] font-semibold text-[13px] cursor-pointer"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="py-12 px-7 text-center border border-[var(--rose)] rounded-[14px] bg-[var(--paper)]">
      <h3 className="m-0 mb-2 text-lg font-semibold text-[#6f2920]">No se pudieron cargar las canchas</h3>
      <p className="m-0 mx-auto text-sm text-[var(--muted)] max-w-[480px] leading-[1.5] font-mono">{message}</p>
    </div>
  );
}

function OwnerCta({ onClick }: { onClick: () => void }) {
  return (
    <div className="mt-14 px-7 py-6 rounded-[14px] border border-[var(--line)] bg-[linear-gradient(135deg,var(--paper-2),var(--paper))] flex flex-wrap items-center gap-6">
      <div className="w-[52px] h-[52px] rounded-[14px] bg-[var(--accent-soft)] grid place-items-center text-[var(--accent-deep)] shrink-0">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <div className="flex-1 min-w-[240px]">
        <h3 className="m-0 mb-1 text-base font-semibold">¿Tienes una cancha? Cobra en ADA por cada hora reservada.</h3>
        <p className="m-0 text-[13px] text-[var(--muted)] leading-[1.5]">
          Registra tu cancha una vez, fija tus precios y recibe los pagos directo a tu wallet. Comisión 1%.
        </p>
      </div>
      <button
        type="button"
        onClick={onClick}
        className="px-[18px] py-2.5 rounded-[10px] bg-[var(--ink)] hover:bg-[var(--ink-2)] text-[var(--paper)] font-semibold text-[13px]"
      >
        Registra tu cancha →
      </button>
    </div>
  );
}
