// Drawer derecho (desktop) / bottom sheet (mobile) que muestra un slot.
//
// Dos modos:
//   1) Slot Available           → resumen + CTA "Reservar" (Tx 4)
//   2) Slot Pending|Confirmed|… → resumen del estado + (si el viewer
//                                  es el customer y aún hay tiempo)
//                                  CTA "Cancelar reserva" (Tx 6)

import * as React from 'react';
import type { RentSlotUtxoLike } from './WeekCalendar';
import { formatAda, formatPosixDateTime, slotIdToCoord, shortenAddr } from './lib';
import { SlotStatusBadge } from './atoms';

export interface BookingPanelProps {
  /** El slot seleccionado. Si es null, el panel está cerrado. */
  slot: RentSlotUtxoLike | null;
  onClose: () => void;

  /** Tx 4 — Reserve (solo aplica a slots Available).
   *  `depositOnly` (Mejora N): reserva Pending con depósito del 50% — se
   *  confirma después desde "Mis reservas" pagando el resto. */
  onReserve: (slot: RentSlotUtxoLike, opts?: { depositOnly?: boolean }) => void | Promise<void>;
  /** Tx 6 — CancelRent (aplica si viewer == customer y status Pending|Confirmed). */
  onCancel?: (slot: RentSlotUtxoLike) => void | Promise<void>;
  /** Tx 5 — ConfirmRent (aplica si viewer == customer, status Pending, antes del deadline). */
  onConfirm?: (slot: RentSlotUtxoLike) => void | Promise<void>;
  /** Abre el WalletModal cuando no hay wallet conectada. */
  onConnectWallet: () => void;

  connected: boolean;
  /** PKH (hex, 28 bytes) del viewer conectado — habilita el botón cancelar. */
  viewerPkh?: string | null;
  /** Field's IANA timezone (OwnerRecord.timezone) — defaults to UTC if unknown. */
  timeZone?: string;
}

const DAY_NAMES_FULL_ES = [
  'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo',
];
const DAY_NAMES_SHORT_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export function BookingPanel({
  slot,
  onClose,
  onReserve,
  onCancel,
  onConfirm,
  onConnectWallet,
  connected,
  viewerPkh = null,
  timeZone = 'UTC',
}: BookingPanelProps) {
  const open = slot != null;
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  React.useEffect(() => {
    if (!open) {
      setSubmitting(false);
      setError(null);
    }
  }, [open, slot?.datum.slotId]);

  if (!slot) return null;

  const d = slot.datum;
  const { day, hour } = slotIdToCoord(d.slotId);
  const h0 = pad(hour);
  const h1 = pad((hour + 1) % 24);

  const isAvailable = d.status === 'Available';
  const isCustomer =
    !!viewerPkh &&
    !!d.customerPkh &&
    viewerPkh.toLowerCase() === d.customerPkh.toLowerCase();
  const canCancel =
    (d.status === 'Confirmed' || d.status === 'Pending') &&
    isCustomer &&
    Date.now() < d.cancelDeadline;
  const canConfirm =
    d.status === 'Pending' &&
    isCustomer &&
    Date.now() < d.cancelDeadline;
  const remainingLovelace =
    d.rentPrice > slot.lovelace ? d.rentPrice - slot.lovelace : 0n;

  const handleReserve = async (opts?: { depositOnly?: boolean }) => {
    if (!connected) {
      onConnectWallet();
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onReserve(slot, opts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!onCancel) return;
    setError(null);
    setSubmitting(true);
    try {
      await onCancel(slot);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async () => {
    if (!onConfirm) return;
    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(slot);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <style>{`@keyframes bp-fade { from { opacity: 0; } to { opacity: 1; } }`}</style>

      <div
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        className="fixed inset-0 z-[90] bg-[rgba(26,26,23,0.30)]"
        style={{ animation: 'bp-fade 180ms ease' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bp-title"
      >
        <aside
          onMouseDown={(e) => e.stopPropagation()}
          className={[
            'fixed bg-[var(--paper)] flex flex-col z-[100]',
            'shadow-[-8px_0_30px_rgba(20,16,8,.10)] border-[var(--line)]',
            'top-0 right-0 bottom-0 w-full max-w-[420px] border-l',
            'max-sm:top-auto max-sm:left-0 max-sm:max-w-none max-sm:rounded-t-[18px] max-sm:border-l-0 max-sm:border-t max-sm:max-h-[88vh]',
            'transition-transform duration-[250ms] [transition-timing-function:cubic-bezier(.2,.7,.3,1)]',
          ].join(' ')}
        >
          {/* Header */}
          <header className="relative px-6 pt-[22px] pb-2 border-b border-[var(--line)]">
            <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--muted)] font-bold mb-1">
              {isAvailable ? 'Reservar slot' : isCustomer ? 'Tu reserva' : 'Estado del slot'}
            </div>
            <h3 id="bp-title" className="m-0 mb-1 text-[22px] font-bold tracking-[-0.018em]">
              {DAY_NAMES_SHORT_ES[day]} · {h0}:00–{h1}:00
            </h3>
            <p className="m-0 mb-3.5 text-[var(--muted)] text-[13px]">
              {fullDateLabel(d.slotStart, timeZone)}
            </p>
            <SlotStatusBadge status={d.status} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="absolute top-[18px] right-[18px] w-8 h-8 grid place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--paper-2)] hover:text-[var(--ink)]"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {isAvailable ? (
              <AvailableBody d={d} timeZone={timeZone} />
            ) : (
              <>
                {canConfirm && remainingLovelace > 0n && (
                  <div className="pt-3.5">
                    <NoteBox tone="amber">
                      Reserva apartada con depósito del 50%. Te falta pagar{' '}
                      <strong>{(Number(remainingLovelace) / 1_000_000).toFixed(2)} ₳</strong> para
                      confirmarla — hazlo antes del{' '}
                      <strong>{formatPosixDateTime(d.cancelDeadline, 'es', timeZone)}</strong> o el
                      propietario podrá cerrarla y quedarse con el depósito.
                    </NoteBox>
                  </div>
                )}
                <NonAvailableBody d={d} isCustomer={isCustomer} canCancel={canCancel} timeZone={timeZone} />
              </>
            )}
          </div>

          {/* Error inline */}
          {error && (
            <div
              role="alert"
              className="mx-6 mb-3 flex items-start gap-2 px-3 py-2.5 rounded-[10px] bg-[var(--rose-bg)] border border-[#ecb5ac] text-[var(--rose-ink,#6f2920)] text-[12px] leading-snug"
            >
              <svg className="shrink-0 mt-px" width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
                <path d="M8 4.5v4M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span className="font-mono break-all">{error}</span>
            </div>
          )}

          {/* Footer */}
          <footer className="px-6 py-4 pb-5 border-t border-[var(--line)] bg-[var(--paper)] flex flex-col gap-2">
            {isAvailable ? (
              <>
                <ReserveButton
                  connected={connected}
                  submitting={submitting}
                  onClick={() => handleReserve()}
                />
                {connected && (
                  <DepositReserveButton
                    submitting={submitting}
                    depositAda={Number(d.rentPrice) / 2_000_000}
                    onClick={() => handleReserve({ depositOnly: true })}
                  />
                )}
              </>
            ) : (
              <>
                {canConfirm && onConfirm && (
                  <ConfirmButton
                    submitting={submitting}
                    remainingAda={Number(remainingLovelace) / 1_000_000}
                    onClick={handleConfirm}
                  />
                )}
                {canCancel && onCancel && (
                  <CancelButton submitting={submitting} onClick={handleCancel} />
                )}
              </>
            )}

            <button
              type="button"
              onClick={onClose}
              className="w-full p-[11px] rounded-[10px] border border-[var(--line-strong)] bg-[var(--paper)] text-[var(--ink)] font-medium text-[13px] cursor-pointer hover:border-[var(--ink)]"
            >
              Cerrar
            </button>
          </footer>
        </aside>
      </div>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────
// Body — Available
// ───────────────────────────────────────────────────────────────────

function AvailableBody({ d, timeZone }: { d: RentSlotUtxoLike['datum']; timeZone: string }) {
  const cancelLabel = formatPosixDateTime(d.cancelDeadline, 'es', timeZone);
  const rentAda = Number(d.rentPrice) / 1_000_000;
  const commission = (rentAda * d.siteCommissionBps) / 10_000;
  const total = rentAda + commission;
  const cancelPenalty = 2;
  const refundOnCancel = Math.max(0, rentAda - cancelPenalty);

  return (
    <>
      <Section title="Resumen del pago">
        <KvRow label="Precio del slot" value={formatAda(d.rentPrice, { decimals: 2 })} />
        <KvRow
          label={`Comisión plataforma (${formatBps(d.siteCommissionBps)})`}
          value={`${commission.toFixed(2)} ₳`}
        />
        <KvRow label="Total a bloquear" value={`${total.toFixed(2)} ₳`} total />
      </Section>

      <Section title="Política de cancelación">
        <NoteBox>
          Puedes cancelar hasta el <strong>{cancelLabel}</strong>. La cancelación devuelve{' '}
          <strong>{refundOnCancel.toFixed(2)} ₳</strong> (descuento de {cancelPenalty} ₳ por penalidad on-chain).
        </NoteBox>
      </Section>

      <Section title="Separar con el 50%">
        <NoteBox tone="amber">
          También puedes apartar el turno pagando solo <strong>{(rentAda / 2).toFixed(2)} ₳</strong> ahora.
          Después debes confirmar desde <strong>Mis reservas</strong> pagando el resto{' '}
          <strong>antes del {cancelLabel}</strong> — si no confirmas, el propietario puede cerrar
          la reserva y quedarse con el depósito.
        </NoteBox>
      </Section>

      <Section title="On-chain" last>
        <KvRow label="slotId" value={String(d.slotId)} mono />
        <KvRow label="slotStart" value={formatPosixDateTime(d.slotStart, 'es', timeZone)} mono />
        <KvRow label="cancelDeadline" value={cancelLabel} mono />
        <KvRow label="ownerNFTName" value={shortenAddr(d.ownerNFTName, 6, 4)} mono />
      </Section>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────
// Body — non-Available
// ───────────────────────────────────────────────────────────────────

function NonAvailableBody({
  d,
  isCustomer,
  canCancel,
  timeZone,
}: {
  d: RentSlotUtxoLike['datum'];
  isCustomer: boolean;
  canCancel: boolean;
  timeZone: string;
}) {
  const cancelLabel = formatPosixDateTime(d.cancelDeadline, 'es', timeZone);
  const past = Date.now() > d.cancelDeadline;
  const rentAda = Number(d.rentPrice) / 1_000_000;
  const cancelPenalty = 2;
  const refundOnCancel = Math.max(0, rentAda - cancelPenalty);

  return (
    <>
      <Section title="Detalles del slot">
        <KvRow label="slotId" value={String(d.slotId)} mono />
        <KvRow label="Precio" value={formatAda(d.rentPrice, { decimals: 2 })} />
        <KvRow label="slotStart" value={formatPosixDateTime(d.slotStart, 'es', timeZone)} mono />
        <KvRow label="slotEnd" value={formatPosixDateTime(d.slotEnd, 'es', timeZone)} mono />
      </Section>

      <Section title="Cancelación">
        {past ? (
          <NoteBox tone="muted">
            El plazo de cancelación venció el <strong>{cancelLabel}</strong>.
          </NoteBox>
        ) : isCustomer && (d.status === 'Confirmed' || d.status === 'Pending') ? (
          <NoteBox tone="amber">
            Puedes cancelar hasta el <strong>{cancelLabel}</strong>. Recibirás{' '}
            <strong>{refundOnCancel.toFixed(2)} ₳</strong> de vuelta (descuento de {cancelPenalty} ₳ por penalidad on-chain).
          </NoteBox>
        ) : (
          <NoteBox tone="muted">
            Plazo: <strong>{cancelLabel}</strong>.
          </NoteBox>
        )}
        {!isCustomer && d.customerPkh && (
          <p className="mt-2 text-[12px] text-[var(--muted)]">
            Solo el customer original (<span className="font-mono">{shortenAddr(d.customerPkh, 8, 4)}</span>) puede cancelar este slot.
          </p>
        )}
      </Section>

      <Section title="On-chain" last>
        <KvRow label="ownerNFTName" value={shortenAddr(d.ownerNFTName, 6, 4)} mono />
        {d.customerPkh && (
          <KvRow label="customerPkh" value={shortenAddr(d.customerPkh, 8, 4)} mono />
        )}
        {d.rentNFTName && (
          <KvRow label="rentNFTName" value={shortenAddr(d.rentNFTName, 8, 4)} mono />
        )}
        {d.disputeDeposit != null && (
          <KvRow
            label="disputeDeposit"
            value={formatAda(d.disputeDeposit, { decimals: 2 })}
            mono
          />
        )}
      </Section>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────
// CTA buttons
// ───────────────────────────────────────────────────────────────────

function ReserveButton({
  connected,
  submitting,
  onClick,
}: {
  connected: boolean;
  submitting: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={submitting}
      className={[
        'w-full p-[13px] rounded-[10px] border-0 bg-[var(--accent)] text-white font-semibold text-[15px]',
        'cursor-pointer flex items-center justify-center gap-2',
        'hover:bg-[var(--accent-deep)] transition-colors',
        submitting ? 'opacity-60 cursor-wait' : '',
      ].join(' ')}
    >
      {!connected ? (
        <>Conectar wallet</>
      ) : submitting ? (
        <>Procesando…</>
      ) : (
        <>
          Reservar
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </>
      )}
    </button>
  );
}

function ConfirmButton({
  submitting,
  remainingAda,
  onClick,
}: {
  submitting: boolean;
  remainingAda: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={submitting}
      className={[
        'w-full p-[13px] rounded-[10px] border-0 bg-[var(--accent)] text-white font-semibold text-[15px]',
        'cursor-pointer flex items-center justify-center gap-2',
        'hover:bg-[var(--accent-deep)] transition-colors',
        submitting ? 'opacity-60 cursor-wait' : '',
      ].join(' ')}
    >
      {submitting ? 'Procesando…' : `Confirmar reserva (pagar ${remainingAda.toFixed(2)} ₳)`}
    </button>
  );
}

function DepositReserveButton({
  submitting,
  depositAda,
  onClick,
}: {
  submitting: boolean;
  depositAda: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={submitting}
      className={[
        'w-full p-[12px] rounded-[10px] border border-[var(--accent)] bg-[var(--paper)] text-[var(--accent-deep,#d44a2f)] font-semibold text-[14px]',
        'cursor-pointer flex items-center justify-center gap-2',
        'hover:bg-[var(--accent-soft,#ffe1d8)] transition-colors',
        submitting ? 'opacity-60 cursor-wait' : '',
      ].join(' ')}
    >
      {submitting ? 'Procesando…' : `Separar con 50% (${depositAda.toFixed(2)} ₳)`}
    </button>
  );
}

function CancelButton({
  submitting,
  onClick,
}: {
  submitting: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={submitting}
      className={[
        'w-full p-[13px] rounded-[10px] border-0 bg-[#ef4444] text-white font-semibold text-[15px]',
        'cursor-pointer flex items-center justify-center gap-2',
        'hover:bg-[#dc2626] transition-colors',
        submitting ? 'opacity-60 cursor-wait' : '',
      ].join(' ')}
    >
      {submitting ? (
        'Procesando…'
      ) : (
        <>
          Cancelar reserva
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </>
      )}
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────
// Shared bits
// ───────────────────────────────────────────────────────────────────

function Section({
  title,
  children,
  last,
}: {
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <section className={['py-3.5', last ? '' : 'border-b border-[var(--line)]'].join(' ')}>
      <h4 className="m-0 mb-2.5 text-[11px] uppercase tracking-[0.06em] text-[var(--muted)] font-bold">
        {title}
      </h4>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function KvRow({
  label,
  value,
  mono,
  total,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  total?: boolean;
}) {
  return (
    <div
      className={[
        'flex justify-between items-baseline py-[5px] text-[14px]',
        total ? 'pt-3 mt-1 border-t border-dashed border-[var(--line-strong)]' : '',
      ].join(' ')}
    >
      <span className={total ? 'font-bold text-[var(--ink)] text-[16px]' : 'text-[var(--muted)]'}>
        {label}
      </span>
      <span
        className={[
          mono ? 'font-mono text-[13px]' : '',
          total ? 'font-bold text-[var(--ink)] text-[16px]' : 'font-medium text-[var(--ink)]',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
}

function NoteBox({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'muted' | 'amber';
}) {
  const toneCls = {
    neutral: 'bg-[var(--paper-2)] text-[var(--ink-2)]',
    muted: 'bg-[var(--paper-2)] text-[var(--muted)]',
    amber: 'bg-[var(--amber-bg)] text-[var(--amber-ink,#6b4d10)] border border-[#ebd187]',
  }[tone];
  return (
    <p className={['m-0 flex items-start gap-2 p-3 px-3.5 rounded-[10px] text-[12px] leading-snug', toneCls].join(' ')}>
      <svg className="shrink-0 mt-px opacity-70" width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 4.5v4M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

function fullDateLabel(t: number, timeZone: string): string {
  // Must be formatted in the field's own timezone — matches WeekCalendar's hour
  // grid (derived from slotId, implicitly local) and formatPosixDateTime.
  const d = new Date(t);
  const weekdayName = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(d);
  const dayName = DAY_NAMES_FULL_ES[WEEKDAY_INDEX_EN[weekdayName] ?? 0];
  return `${dayName} ${d.toLocaleDateString('es-AR', {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })}`;
}

const WEEKDAY_INDEX_EN: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
