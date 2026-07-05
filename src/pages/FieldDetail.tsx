// react/FieldDetail.tsx
// Página /field/:ownerNFT — perfil completo de una cancha + calendario
// semanal interactivo.
//
// Datos:
//   useRentSlots(ownerNFT)      → todos los slots de esta cancha
//   useOwnerRecord(ownerNFTName) → stats de reputación + metadata canónica
//   useLucid()                  → estado de la wallet del visitante
//
// Identidad del viewer: pkh extraído directamente de useLucid().

import * as React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLucid } from '../lib/LucidContext';

import type { RentDatum } from '../components/types';
import {
  decodeBBS,
  parseLatLong,
  shortenAddr,
} from '../components/lib';
import { useRentSlots } from '../hooks/useRentSlots';
import type { RentSlotUtxo, ListHeadUtxo } from '../hooks/useRentSlots';
import { useOwnerRecord } from '../hooks/useOwnerRecord';
import { useCancelSlot } from '../hooks/useCancelSlot';

import { WeekCalendar, CalendarLegend } from '../components/WeekCalendar';
import type { RentSlotUtxoLike } from '../components/WeekCalendar';
import { BookingPanel } from '../components/BookingPanel';
import { WalletModal } from '../components/WalletModal';
import { FieldMap } from '../components/FieldMap';
import { useReserveSlot } from '../hooks/useReserveSlot';

// ───────────────────────────────────────────────────────────────────
// Page
// ───────────────────────────────────────────────────────────────────

export default function FieldDetail() {
  const { ownerNFT = '' } = useParams<{ ownerNFT: string }>();
  const [searchParams] = useSearchParams();
  const fieldNameFilter = searchParams.get('fn');
  const weekStartParam  = searchParams.get('ws') ? Number(searchParams.get('ws')) : null;
  const navigate = useNavigate();
  const { connected, pkh: viewerPkh } = useLucid();

  const { slots, heads, loading: slotsLoading, error: slotsError, reload } = useRentSlots(ownerNFT);

  // ── Semanas disponibles (una head por semana inicializada) ──
  const sortedHeads = React.useMemo(() => {
    const filtered = fieldNameFilter
      ? heads.filter(h => h.datum.fieldName === fieldNameFilter)
      : heads
    return [...filtered].sort((a, b) => a.datum.config.weekStartPosix - b.datum.config.weekStartPosix)
  }, [heads, fieldNameFilter]);

  const [weekIdx, setWeekIdx] = React.useState(0);

  // Al cargar, saltar a la semana indicada por URL (?ws=), o la que contiene "ahora", o la última
  React.useEffect(() => {
    if (sortedHeads.length === 0) return;
    if (weekStartParam != null) {
      const idx = sortedHeads.findIndex(h => h.datum.config.weekStartPosix === weekStartParam);
      if (idx >= 0) { setWeekIdx(idx); return; }
    }
    const nowMs = Date.now();
    const idx = sortedHeads.findIndex(h => {
      const ws = h.datum.config.weekStartPosix;
      return nowMs >= ws && nowMs < ws + 7 * 24 * 3_600_000;
    });
    setWeekIdx(idx >= 0 ? idx : sortedHeads.length - 1);
  }, [sortedHeads.length, weekStartParam]);

  const head = sortedHeads[weekIdx] ?? null;

  // Slots filtrados por la semana seleccionada
  const weekSlots = React.useMemo(() => {
    if (!head) return slots;
    const weekEnd = head.datum.config.weekStartPosix + 7 * 24 * 3_600_000;
    return slots.filter(s => s.datum.weekEnd === weekEnd && s.datum.fieldName === head.datum.fieldName);
  }, [slots, head]);

  // Must look up by ownerNFTName, not ownerPkh — a wallet can own multiple
  // fields, and web registrations mint ownerNFTName = ownerPkh + random
  // suffix (different from ownerPkh) — see useOwnerRecord.ts.
  const ownerNFTNameForRecord = head?.datum.ownerNFTName ?? slots?.[0]?.datum.ownerNFTName ?? '';
  const { record, loading: recordLoading } = useOwnerRecord(ownerNFTNameForRecord);

  const [selected, setSelected] = React.useState<RentSlotUtxoLike | null>(null);
  const [walletModalOpen, setWalletModalOpen] = React.useState(false);
  const { reserve, loading: reserving, error: reserveError } = useReserveSlot();
  const { cancel: cancelSlot } = useCancelSlot();
  const [reserveTxHash, setReserveTxHash] = React.useState<string | null>(null);
  const [cancelTxHash, setCancelTxHash] = React.useState<string | null>(null);

  const calendarRef = React.useRef<HTMLDivElement>(null);

  // ── Identidad de la cancha ──────────────────────────────────
  const identity = React.useMemo(() => {
    if (record) {
      return {
        fieldName: decodeBBS(record.fieldName),
        fieldAddress: decodeBBS(record.address),
        phone: decodeBBS(record.phone),
        email: decodeBBS(record.email),
        lat: record.lat,
        long: record.long,
      };
    }
    if (head) {
      const h = head.datum;
      return {
        fieldName: decodeBBS(h.fieldName),
        fieldAddress: decodeBBS(h.fieldAddress),
        phone: decodeBBS(h.phone),
        email: decodeBBS(h.email),
        lat: h.lat,
        long: h.long,
      };
    }
    const first = slots?.[0]?.datum;
    if (first) {
      return {
        fieldName: decodeBBS(first.fieldName),
        fieldAddress: decodeBBS(first.fieldAddress),
        phone: decodeBBS(first.phone),
        email: decodeBBS(first.email),
        lat: first.lat,
        long: first.long,
      };
    }
    return null;
  }, [record, head, slots]);

  // ── Stats agregadas ─────────────────────────────────────────
  const stats = React.useMemo(() => {
    const taken = new Set(weekSlots.map(s => s.datum.slotId));
    const available = head
      ? head.datum.config.openSlotIds.filter(id => !taken.has(id)).length
      : 0;
    const byStatus: Partial<Record<RentDatum['status'], number>> = {};
    for (const s of weekSlots) byStatus[s.datum.status] = (byStatus[s.datum.status] ?? 0) + 1;
    return { available, byStatus };
  }, [weekSlots, head]);

  // ── Reserva activa del viewer en esta cancha ────────────────
  const myActiveSlot = React.useMemo<RentSlotUtxo | null>(() => {
    if (!viewerPkh || !weekSlots) return null;
    return weekSlots.find(
      (s) =>
        s.datum.customerPkh === viewerPkh &&
        (s.datum.status === 'Pending' || s.datum.status === 'Confirmed'),
    ) ?? null;
  }, [viewerPkh, weekSlots]);

  // ── Precio y comisión ───────────────────────────────────────
  const pricePerHourAda = head
    ? Number(head.datum.config.rentPrice) / 1_000_000
    : (slots?.[0] ? Number(slots[0].datum.rentPrice) / 1_000_000 : 0);
  const commissionBps = head?.datum.config.siteCommissionBps ?? slots?.[0]?.datum.siteCommissionBps ?? 100;

  const scrollToCalendar = () =>
    calendarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // ── Render ──────────────────────────────────────────────────
  if (slotsError) {
    return (
      <main className="max-w-[1280px] mx-auto px-8 max-sm:px-[18px] py-16">
        <h1 className="text-xl font-semibold mb-2">No se pudo cargar la cancha</h1>
        <p className="font-mono text-sm text-[var(--muted)]">{String(slotsError)}</p>
        <button
          onClick={() => navigate('/')}
          className="mt-4 px-3.5 py-2 rounded-lg border border-[var(--line-strong)] text-[var(--ink)] text-sm font-semibold"
        >
          ← Volver
        </button>
      </main>
    );
  }

  const loading = slotsLoading || recordLoading;

  return (
    <main className="max-w-[1280px] mx-auto px-8 max-sm:px-[18px]">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="inline-flex items-center gap-1.5 mt-7 px-2.5 py-1.5 rounded-lg text-[13px] text-[var(--muted)] hover:bg-[var(--paper-2)] hover:text-[var(--ink)]"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Canchas
      </button>

      {/* Cover */}
      <Cover
        ownerNFT={ownerNFT}
        fieldName={identity?.fieldName ?? 'Cancha'}
        fieldAddress={identity?.fieldAddress ?? ''}
        availableNow={stats.available}
        loading={loading}
      />

      {/* Info section */}
      <section className="mt-9 grid grid-cols-[1fr_360px] gap-9 max-[980px]:grid-cols-1 max-[980px]:gap-6">
        <div>
          <SectionHeading>Información del campo</SectionHeading>
          <div className="flex flex-col gap-3.5">
            <InfoRow icon={<PinIcon />} label="Dirección">
              {identity?.fieldAddress ?? '—'}
              {identity && parseLatLong(identity.lat, identity.long) && (
                <>
                  {' · '}
                  <a
                    href={`https://maps.google.com/?q=${decodeBBS(identity.lat)},${decodeBBS(identity.long)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--ink)] no-underline border-b border-dashed border-[var(--line-strong)] hover:text-[var(--accent)] hover:border-[var(--accent)]"
                  >
                    Ver en mapa ↗
                  </a>
                </>
              )}
            </InfoRow>
            <InfoRow icon={<PhoneIcon />} label="Teléfono" mono>
              {identity?.phone ?? '—'}
            </InfoRow>
            <InfoRow icon={<MailIcon />} label="Email" mono>
              {identity?.email ?? '—'}
            </InfoRow>
          </div>

          {identity && (() => {
            const g = parseLatLong(identity.lat, identity.long);
            return g ? (
              <FieldMap
                lat={g.lat}
                long={g.long}
                label={identity.fieldName}
                className="mt-4"
              />
            ) : null;
          })()}

          <SectionHeading className="mt-8">Reputación del dueño</SectionHeading>
          <div className="flex flex-wrap gap-2.5 mt-4">
            <StatPill tone="mint" value={record?.rentalsCompleted ?? '—'} label="reservas completadas" />
            <StatPill tone="mint" value={record?.rentNFTsProven ?? '—'} label="NFTs presentados" />
            <StatPill tone="amber" value={record?.rentalsRefunded ?? '—'} label="reembolsadas" />
            <StatPill tone="neutral" value={record?.rentalsDisputed ?? '—'} label="en disputa" />
          </div>
        </div>

        <PriceCard
          pricePerHourAda={pricePerHourAda}
          commissionBps={commissionBps}
          availableNow={stats.available}
          onSeeCalendar={scrollToCalendar}
          myActiveSlot={myActiveSlot}
        />
      </section>

      {/* Calendar */}
      <section ref={calendarRef} className="mt-14 pb-20" id="calendar">
        <header className="flex flex-wrap items-baseline gap-4 mb-4.5">
          <h2 className="m-0 text-2xl font-bold tracking-[-0.018em]">Calendario semanal</h2>
          <span className="text-[var(--muted)] text-[14px]">7 días × 24 horas · 168 slots</span>
          <WeekNav
            weekIdx={weekIdx}
            totalWeeks={sortedHeads.length}
            head={head}
            timeZone={record?.timezone}
            onPrev={() => setWeekIdx(i => Math.max(0, i - 1))}
            onNext={() => setWeekIdx(i => Math.min(sortedHeads.length - 1, i + 1))}
          />
        </header>

        <div className="mb-3.5">
          <CalendarLegend />
        </div>

        {loading ? (
          <CalendarSkeleton />
        ) : (
          <WeekCalendar
            head={head}
            slots={weekSlots}
            selectedSlotId={selected?.datum.slotId ?? null}
            onSelectSlot={(s) => setSelected(s)}
          />
        )}
      </section>

      {/* Reserve feedback banners */}
      {reserveTxHash && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 px-4 py-3 rounded-[12px] bg-[var(--paper)] border border-[#b9d8c1] shadow-[0_4px_20px_rgba(20,16,8,.12)] text-[13px]">
          <span className="w-2 h-2 rounded-full bg-[var(--mint-deep,#4d9669)]" />
          <span className="font-medium text-[var(--ink)]">¡Reserva confirmada!</span>
          <span className="font-mono text-[var(--muted)] text-[11px]">{reserveTxHash.slice(0, 12)}…</span>
          <button onClick={() => setReserveTxHash(null)} className="ml-2 text-[var(--muted)] hover:text-[var(--ink)]">✕</button>
        </div>
      )}
      {reserveError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 px-4 py-3 rounded-[12px] bg-[var(--paper)] border border-[#ecb5ac] shadow-[0_4px_20px_rgba(20,16,8,.12)] text-[13px]">
          <span className="w-2 h-2 rounded-full bg-[var(--rose,#f0a8a0)]" />
          <span className="font-medium text-[var(--rose-ink,#6f2920)]">Error al reservar</span>
          <span className="text-[var(--muted)] max-w-[280px] truncate">{reserveError}</span>
        </div>
      )}
      {cancelTxHash && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 px-4 py-3 rounded-[12px] bg-[var(--paper)] border border-[#ecb5ac] shadow-[0_4px_20px_rgba(20,16,8,.12)] text-[13px]">
          <span className="w-2 h-2 rounded-full bg-[#ef4444]" />
          <span className="font-medium text-[var(--ink)]">Reserva cancelada</span>
          <span className="font-mono text-[var(--muted)] text-[11px]">{cancelTxHash.slice(0, 12)}…</span>
          <button onClick={() => setCancelTxHash(null)} className="ml-2 text-[var(--muted)] hover:text-[var(--ink)]">✕</button>
        </div>
      )}

      {/* Booking drawer */}
      <BookingPanel
        slot={selected}
        connected={connected}
        viewerPkh={viewerPkh || null}
        timeZone={record?.timezone}
        onClose={() => setSelected(null)}
        onConnectWallet={() => setWalletModalOpen(true)}
        onReserve={async (s) => {
          if (!head) throw new Error('Semana no inicializada');
          const txHash = await reserve(head, s.datum.slotId);
          setSelected(null);
          setReserveTxHash(txHash);
          setTimeout(() => reload(), 3_000);
        }}
        onCancel={async () => {
          const fullSlot = slots.find(s => s.datum.slotId === selected?.datum.slotId);
          if (!fullSlot) return;
          const txHash = await cancelSlot(fullSlot);
          setSelected(null);
          setCancelTxHash(txHash);
          setTimeout(() => reload(), 3_000);
        }}
      />

      <WalletModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
    </main>
  );
}

// ───────────────────────────────────────────────────────────────────
// Cover
// ───────────────────────────────────────────────────────────────────

function Cover({
  ownerNFT,
  fieldName,
  fieldAddress,
  availableNow,
  loading,
}: {
  ownerNFT: string;
  fieldName: string;
  fieldAddress: string;
  availableNow: number;
  loading: boolean;
}) {
  return (
    <div className="relative mt-3.5 rounded-[18px] overflow-hidden border border-[var(--line)] aspect-[21/9] max-h-[360px] bg-[var(--paper-2)]">
      <CoverIllus ownerNFT={ownerNFT} />
      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.55)_0%,rgba(0,0,0,0.10)_45%,transparent_75%)]" />

      <div className="absolute top-4.5 left-4.5 flex gap-2">
        {availableNow > 0 && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--mint)] text-[var(--mint-ink,#244d33)] text-[12px] font-semibold backdrop-blur-md">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--mint-deep,#4d9669)]" />
            {availableNow} slots libres
          </span>
        )}
        <span className="px-3 py-1.5 rounded-full bg-white/95 text-[var(--ink)] text-[12px] font-semibold backdrop-blur-md">
          Cardano Preview
        </span>
      </div>

      <span className="absolute top-4.5 right-4.5 px-2.5 py-1 rounded-lg bg-[rgba(26,26,23,0.75)] text-[var(--paper)] font-mono text-[11px] backdrop-blur-sm">
        {shortenAddr(ownerNFT, 6, 4)}
      </span>

      <div className="absolute left-7 right-7 bottom-6 text-white">
        <h1 className="m-0 mb-1.5 text-[clamp(28px,4.5vw,44px)] leading-[1.05] tracking-[-0.02em] font-bold drop-shadow-[0_2px_8px_rgba(0,0,0,0.25)]">
          {loading ? 'Cargando…' : fieldName}
        </h1>
        <div className="flex items-center gap-1.5 text-[14px] opacity-90">
          <PinIconWhite />
          {fieldAddress}
        </div>
      </div>
    </div>
  );
}

function CoverIllus({ ownerNFT }: { ownerNFT: string }) {
  // Gradient determinístico (mismo algoritmo que FieldCard para que la
  // misma cancha mantenga el color al navegar desde Discovery).
  const palettes: [string, string][] = [
    ['#5d9d6c', '#1f3d2a'],
    ['#5d8fb5', '#2d5478'],
    ['#d97a4f', '#a14a26'],
    ['#d8a767', '#8e5e2c'],
    ['#e8d59c', '#b9974a'],
    ['#a8a597', '#5e5b54'],
    ['#7fb685', '#3f7a4d'],
    ['#c47b91', '#7d3f54'],
  ];
  let h = 0;
  for (let i = 0; i < ownerNFT.length; i++) h = (h * 31 + ownerNFT.charCodeAt(i)) >>> 0;
  const [a, b] = palettes[h % palettes.length];
  const gid = `fd-cover-${h % 1000}`;
  return (
    <svg viewBox="0 0 600 240" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
      </defs>
      <rect width="600" height="240" fill={`url(#${gid})`} />
      <rect x="60" y="40" width="480" height="160" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
      <line x1="300" y1="40" x2="300" y2="200" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
      <circle cx="300" cy="120" r="42" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
      <rect x="60" y="90" width="40" height="60" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
      <rect x="500" y="90" width="40" height="60" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
    </svg>
  );
}

// ───────────────────────────────────────────────────────────────────
// Price card (right column)
// ───────────────────────────────────────────────────────────────────

function PriceCard({
  pricePerHourAda,
  commissionBps,
  availableNow,
  onSeeCalendar,
  myActiveSlot,
}: {
  pricePerHourAda: number;
  commissionBps: number;
  availableNow: number;
  onSeeCalendar: () => void;
  myActiveSlot: RentSlotUtxo | null;
}) {
  return (
    <aside className="sticky top-[84px] self-start bg-[var(--paper)] border border-[var(--line)] rounded-[14px] p-5 pt-5.5 shadow-[0_1px_2px_rgba(20,16,8,.04),0_6px_18px_rgba(20,16,8,.06)]">
      <div className="flex items-baseline gap-1 mb-1">
        <span className="text-[36px] font-bold tracking-[-0.025em] text-[var(--accent)]">
          {pricePerHourAda || '—'}
        </span>
        <span className="text-[18px] font-bold text-[var(--accent)]">₳</span>
        <span className="text-[14px] text-[var(--muted)] ml-1.5">/ hora</span>
      </div>
      <p className="m-0 mb-4 text-[12px] text-[var(--muted)]">
        + comisión {(commissionBps / 100).toFixed(commissionBps % 100 === 0 ? 0 : 2)}% de la plataforma
      </p>

      <div className="flex items-center gap-2 px-3.5 py-3 rounded-[10px] bg-[var(--mint-bg)] border border-[#b9d8c1] mb-4">
        <svg className="shrink-0" width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--mint-deep,#4d9669)' }}>
          <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5 2v3M11 2v3M2.5 7h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <span className="text-[13px] font-medium text-[var(--mint-ink,#244d33)]">
          <span className="font-mono font-bold text-[16px]">{availableNow}</span> slots disponibles esta semana
        </span>
      </div>

      <button
        type="button"
        onClick={onSeeCalendar}
        className="w-full p-3 rounded-[10px] border-0 bg-[var(--ink)] hover:bg-[var(--ink-2)] text-[var(--paper)] font-semibold text-[14px] cursor-pointer flex items-center justify-center gap-2"
      >
        Ver calendario
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M8 3v10M3 8l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {myActiveSlot && (
        <div className="mt-3.5 p-3 px-3.5 rounded-[10px] bg-[var(--accent-soft)] border border-[#f7c6b6] text-[13px] flex items-center gap-2.5 text-[var(--accent-deep,#d44a2f)]">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 4.5v4M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span>Tienes una reserva activa</span>
          <a
            href={`#slot-${myActiveSlot.datum.slotId}`}
            className="ml-auto font-semibold no-underline border-b border-dashed border-[var(--accent-deep,#d44a2f)]"
            style={{ color: 'var(--accent-deep,#d44a2f)' }}
          >
            Ver slot →
          </a>
        </div>
      )}
    </aside>
  );
}

// ───────────────────────────────────────────────────────────────────
// Bits
// ───────────────────────────────────────────────────────────────────

function SectionHeading({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2 className={['m-0 mb-3.5 text-[13px] uppercase tracking-[0.08em] text-[var(--muted)] font-bold', className].join(' ')}>
      {children}
    </h2>
  );
}

function InfoRow({
  icon,
  label,
  children,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 text-[14px] text-[var(--ink)]">
      <div className="w-8 h-8 shrink-0 rounded-[9px] bg-[var(--paper-2)] border border-[var(--line)] grid place-items-center text-[var(--muted)]">
        {icon}
      </div>
      <div>
        <span className="block text-[11px] uppercase tracking-[0.06em] text-[var(--muted)] font-semibold mb-0.5">
          {label}
        </span>
        <span className={['font-medium', mono ? 'font-mono text-[13px]' : ''].join(' ')}>{children}</span>
      </div>
    </div>
  );
}

function StatPill({
  tone,
  value,
  label,
}: {
  tone: 'mint' | 'amber' | 'neutral';
  value: number | string;
  label: string;
}) {
  const toneCls = {
    mint: 'bg-[var(--mint-bg)] border-[#b9d8c1] text-[var(--mint-ink,#244d33)]',
    amber: 'bg-[var(--amber-bg)] border-[#ebd187] text-[var(--amber-ink,#6b4d10)]',
    neutral: 'bg-[var(--paper)] border-[var(--line)] text-[var(--ink)]',
  }[tone];
  return (
    <span className={['inline-flex items-center gap-2 px-3 py-2 rounded-[10px] border text-[13px]', toneCls].join(' ')}>
      <span className="font-mono font-bold text-[16px]">{value}</span>
      <span className="text-[var(--muted)] text-[12px]">{label}</span>
    </span>
  );
}

function WeekNav({
  weekIdx,
  totalWeeks,
  head,
  timeZone,
  onPrev,
  onNext,
}: {
  weekIdx: number;
  totalWeeks: number;
  head: ListHeadUtxo | null;
  timeZone?: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  const canPrev = weekIdx > 0;
  const canNext = weekIdx < totalWeeks - 1;
  const label = head ? weekLabel(head.datum.config.weekStartPosix, timeZone || 'UTC') : '—';
  const btnCls = (enabled: boolean) =>
    [
      'w-8 h-8 border border-[var(--line-strong)] bg-[var(--paper)] rounded-lg grid place-items-center',
      enabled
        ? 'text-[var(--ink)] hover:bg-[var(--paper-2)] cursor-pointer'
        : 'text-[var(--ink-2)] cursor-not-allowed opacity-45',
    ].join(' ');
  return (
    <div className="ml-auto flex items-center gap-1.5">
      <button type="button" disabled={!canPrev} onClick={onPrev} className={btnCls(canPrev)}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <span className="px-3 py-1.5 rounded-lg bg-[var(--paper-2)] text-[13px] font-semibold text-[var(--ink)]">
        {totalWeeks > 1 ? `Semana ${weekIdx + 1}/${totalWeeks}` : 'Semana actual'}{' '}
        <span className="font-mono font-medium text-[var(--muted)] ml-1">{label}</span>
      </span>
      <button type="button" disabled={!canNext} onClick={onNext} className={btnCls(canNext)}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

function weekLabel(weekStartPosix: number, timeZone: string): string {
  const fmt = (ts: number) =>
    new Date(ts).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone })
  return `${fmt(weekStartPosix)} – ${fmt(weekStartPosix + 6 * 24 * 3_600_000)}`
}

function CalendarSkeleton() {
  return (
    <>
      <style>{`@keyframes fd-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      <div
        className="rounded-[14px] border border-[var(--line)] overflow-hidden bg-[linear-gradient(90deg,var(--paper-2)_0%,var(--paper-3)_50%,var(--paper-2)_100%)] [background-size:200%_100%]"
        style={{ animation: 'fd-shimmer 1.4s ease-in-out infinite', height: 36 * 25 }}
      />
    </>
  );
}

// ───────────────────────────────────────────────────────────────────
// Icons
// ───────────────────────────────────────────────────────────────────

function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M8 14s4.5-4 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 10 8 14 8 14z" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="6.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function PinIconWhite() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M8 14s4.5-4 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 10 8 14 8 14z" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="6.5" r="1.6" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
function PhoneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M3.5 2.5h2l1 3-1.5 1A8 8 0 0 0 9 11l1-1.5 3 1v2A1.5 1.5 0 0 1 11.5 14C7 14 2 9 2 4.5A1.5 1.5 0 0 1 3.5 2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.5 4.5l5.5 4 5.5-4" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
function GlobeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.5 6h9M3.5 10h9M8 1.5c2 2.5 2 10 0 13M8 1.5c-2 2.5-2 10 0 13" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
