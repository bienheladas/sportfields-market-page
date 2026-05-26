import * as React from 'react'
import { useCancelRent } from '../hooks/useCancelRent'
import { useOpenDispute } from '../hooks/useOpenDispute'
import { useRedeemAtField } from '../hooks/useRedeemAtField'
import { decodeBBS, formatAda, formatPosixDateTime, shortenAddr } from './lib'
import type { RentSlotUtxo } from '../hooks/useRentSlots'

// ── Types ──────────────────────────────────────────────────────────────

interface ReservationCardProps {
  slot: RentSlotUtxo
  onActionDone: () => void
}

// ── Field illustration thumb ───────────────────────────────────────────

function FieldThumb() {
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg"
      className="rounded-[10px] flex-shrink-0">
      <defs>
        <linearGradient id="fg" x1="0" y1="0" x2="0" y2="96" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#16a34a" />
          <stop offset="100%" stopColor="#14532d" />
        </linearGradient>
      </defs>
      <rect width="96" height="96" rx="10" fill="url(#fg)" />
      {/* field outline */}
      <rect x="8" y="16" width="80" height="64" rx="2" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" fill="none" />
      {/* center line */}
      <line x1="48" y1="16" x2="48" y2="80" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
      {/* center circle */}
      <circle cx="48" cy="48" r="12" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" fill="none" />
      {/* center dot */}
      <circle cx="48" cy="48" r="2" fill="rgba(255,255,255,0.7)" />
      {/* goal areas */}
      <rect x="8" y="33" width="14" height="30" stroke="rgba(255,255,255,0.35)" strokeWidth="1" fill="none" />
      <rect x="74" y="33" width="14" height="30" stroke="rgba(255,255,255,0.35)" strokeWidth="1" fill="none" />
    </svg>
  )
}

// ── Status pill ────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Confirmed: 'bg-[var(--mint-bg)] text-[var(--mint-ink)]',
    Disputed:  'bg-[var(--rose-bg)] text-[var(--rose-ink)]',
    Completed: 'bg-[var(--slate-bg)] text-[var(--slate-ink)]',
    Refunded:  'bg-[var(--paper-2)] text-[var(--muted)]',
  }
  const labels: Record<string, string> = {
    Confirmed: 'Confirmado',
    Disputed:  'En disputa',
    Completed: 'Jugado',
    Refunded:  'Reembolsado',
  }
  const dotColors: Record<string, string> = {
    Confirmed: 'bg-[var(--mint-ink)]',
    Disputed:  'bg-[var(--rose-ink)]',
    Completed: 'bg-[var(--slate-ink)]',
    Refunded:  'bg-[var(--muted)]',
  }
  const cls = styles[status] ?? 'bg-[var(--paper-2)] text-[var(--muted)]'
  const dot = dotColors[status] ?? 'bg-[var(--muted)]'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {labels[status] ?? status}
    </span>
  )
}

// ── Escrow label ───────────────────────────────────────────────────────

function escrowLabel(status: string): string {
  if (status === 'Confirmed') return 'en escrow'
  if (status === 'Disputed')  return 'en disputa'
  if (status === 'Completed') return 'liberado'
  return ''
}

// ── Modal backdrop + container ─────────────────────────────────────────

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[var(--paper)] rounded-2xl max-w-sm w-full border border-[var(--line)] shadow-2xl overflow-hidden mx-4">
        {children}
      </div>
    </div>
  )
}

// ── Summary row ────────────────────────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-4 py-1.5 border-b border-[var(--line)] last:border-0">
      <span className="text-[var(--muted)] text-xs whitespace-nowrap">{label}</span>
      <span className="text-xs font-mono text-[var(--ink)] text-right break-all">{value}</span>
    </div>
  )
}

// ── Date formatter ─────────────────────────────────────────────────────

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString('es', { timeZone: 'UTC' })
}

// ── Main component ─────────────────────────────────────────────────────

export function ReservationCard({ slot, onActionDone }: ReservationCardProps) {
  const { cancel,        loading: loadingCancel,  error: errCancel  } = useCancelRent()
  const { openDispute,   loading: loadingDispute, error: errDispute } = useOpenDispute()
  const { redeemAtField, loading: loadingRedeem,  error: errRedeem  } = useRedeemAtField()

  const [showCancelModal,  setShowCancelModal]  = React.useState(false)
  const [showDisputeModal, setShowDisputeModal] = React.useState(false)
  const [showRedeemModal,  setShowRedeemModal]  = React.useState(false)

  const datum  = slot.datum
  const status = datum.status

  const [now, setNow] = React.useState(Date.now())
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const isLoading  = loadingCancel || loadingDispute || loadingRedeem
  const anyError   = errCancel || errDispute || errRedeem

  // ── Derived display values ─────────────────────────────────────────
  const fieldName    = decodeBBS(datum.fieldName)
  const fieldAddress = decodeBBS(datum.fieldAddress)

  const nftLabel = datum.rentNFTName
    ? Buffer.from(datum.rentNFTName, 'hex').toString('utf8').slice(0, 20)
    : null

  // Active now = slot is ongoing
  const isActiveNow = now >= datum.slotStart && now <= datum.slotEnd

  // ── Action visibility logic ────────────────────────────────────────
  const canCancel       = status === 'Confirmed'
  const cancelDeadlineOk = now < datum.cancelDeadline
  const canRedeem       = status === 'Confirmed'
  const redeemEnabled   = now >= datum.slotStart
  const canDispute      = status === 'Confirmed' && now > datum.cancelDeadline

  // ── Handlers ──────────────────────────────────────────────────────
  const handleCancel = async () => {
    try {
      await cancel(slot)
      setShowCancelModal(false)
      onActionDone()
    } catch { /* error shown inline */ }
  }

  const handleDispute = async () => {
    try {
      await openDispute(slot)
      setShowDisputeModal(false)
      onActionDone()
    } catch { /* error shown inline */ }
  }

  const handleRedeem = async () => {
    try {
      await redeemAtField(slot)
      setShowRedeemModal(false)
      onActionDone()
    } catch { /* error shown inline */ }
  }

  // ── Card border style ──────────────────────────────────────────────
  const borderClass = isActiveNow
    ? 'border-[var(--accent)] ring-[3px] ring-[var(--accent-soft)]'
    : 'border-[var(--line)]'

  return (
    <>
      {/* ── Card ──────────────────────────────────────────────────── */}
      <div className={`rounded-[14px] border ${borderClass} bg-[var(--paper)] shadow-sm overflow-hidden`}>

        {/* Top section: thumb | body | right */}
        <div className="p-4 grid grid-cols-[auto_1fr_auto] gap-4 items-start">

          {/* Thumb */}
          <FieldThumb />

          {/* Body */}
          <div className="min-w-0">
            <h3 className="font-semibold text-[var(--ink)] text-base leading-snug truncate">
              {fieldName}
            </h3>
            <p className="text-[var(--muted)] text-xs mt-0.5 truncate">
              {fieldAddress} · Slot #{datum.slotId}
            </p>
            {/* When block */}
            <div className="mt-2 flex flex-wrap gap-2 items-center">
              <span className="text-xs text-[var(--ink-2)]">
                {fmtDate(datum.slotStart)} – {fmtDate(datum.slotEnd)}
              </span>
              {nftLabel && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-mono bg-[var(--accent-soft)] text-[var(--accent-deep)]">
                  NFT: {nftLabel}
                </span>
              )}
            </div>
          </div>

          {/* Right: status + price */}
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            <StatusPill status={status} />
            <span className="text-base font-bold text-[var(--ink)]">
              {formatAda(slot.lovelace)}
            </span>
            {escrowLabel(status) && (
              <span className="text-[10px] text-[var(--muted)]">{escrowLabel(status)}</span>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 pb-4 flex flex-wrap items-center justify-between gap-3">

          {/* Left: tx link */}
          <a
            href={`https://preview.cardanoscan.io/transaction/${slot.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-mono text-[var(--accent)] hover:underline"
          >
            {slot.txHash.slice(0, 8)}…#{slot.outputIndex}
          </a>

          {/* Right: action buttons */}
          <div className="flex flex-wrap gap-2">

            {/* Cancel */}
            {canCancel && (
              <div className="relative group">
                <button
                  disabled={!cancelDeadlineOk || isLoading}
                  onClick={() => setShowCancelModal(true)}
                  className="px-3 py-1.5 rounded-[8px] text-xs font-semibold border border-[var(--rose-ink)] text-[var(--rose-ink)] bg-[var(--rose-bg)] hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                >
                  {loadingCancel ? 'Cancelando…' : 'Cancelar reserva'}
                </button>
                {!cancelDeadlineOk && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded bg-[var(--ink)] text-white text-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
                    Deadline de cancelación vencido
                  </div>
                )}
              </div>
            )}

            {/* Redeem */}
            {canRedeem && (
              <div className="relative group">
                <button
                  disabled={!redeemEnabled || isLoading}
                  onClick={() => setShowRedeemModal(true)}
                  className="px-3 py-1.5 rounded-[8px] text-xs font-semibold border border-[var(--mint-ink)] text-[var(--mint-ink)] bg-[var(--mint-bg)] hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                >
                  {loadingRedeem ? 'Redimiendo…' : 'Redimir NFT en cancha'}
                </button>
                {!redeemEnabled && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded bg-[var(--ink)] text-white text-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
                    Disponible desde {fmtDate(datum.slotStart)}
                  </div>
                )}
              </div>
            )}

            {/* Open dispute */}
            {canDispute && (
              <button
                disabled={isLoading}
                onClick={() => setShowDisputeModal(true)}
                className="px-3 py-1.5 rounded-[8px] text-xs font-semibold border border-amber-500 text-amber-700 bg-amber-50 hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                {loadingDispute ? 'Abriendo disputa…' : 'Abrir disputa'}
              </button>
            )}
          </div>
        </div>

        {/* Expandable datum detail */}
        <details className="border-t border-[var(--line)]">
          <summary className="px-4 py-2.5 text-xs text-[var(--muted)] cursor-pointer hover:text-[var(--ink-2)] select-none">
            Datum + Tx detail
          </summary>
          <div className="px-4 pb-3 space-y-0">
            <SummaryRow label="UTxO ref"         value={`${slot.txHash.slice(0,16)}…#${slot.outputIndex}`} />
            <SummaryRow label="Slot ID"           value={String(datum.slotId)} />
            <SummaryRow label="Status"            value={datum.status} />
            <SummaryRow label="Slot start"        value={fmtDate(datum.slotStart)} />
            <SummaryRow label="Slot end"          value={fmtDate(datum.slotEnd)} />
            <SummaryRow label="Cancel deadline"   value={fmtDate(datum.cancelDeadline)} />
            <SummaryRow label="Customer PKH"      value={datum.customerPkh ? shortenAddr(datum.customerPkh) : '—'} />
            <SummaryRow label="Rent price"        value={`${datum.rentPrice.toString()} lovelace`} />
            <SummaryRow label="Lovelace en UTxO"  value={`${slot.lovelace.toString()} lovelace`} />
          </div>
        </details>

        {/* Error display */}
        {anyError && (
          <div className="px-4 pb-3 text-[11px] text-[var(--rose-ink)] bg-[var(--rose-bg)] border-t border-[var(--line)]">
            {anyError}
          </div>
        )}
      </div>

      {/* ── Cancel Modal (Tx 6) ────────────────────────────────────── */}
      {showCancelModal && (
        <Modal onClose={() => setShowCancelModal(false)}>
          <div className="p-5">
            {/* Icon */}
            <div className="w-11 h-11 rounded-full bg-[var(--rose-bg)] flex items-center justify-center mx-auto mb-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                  stroke="var(--rose-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h2 className="text-center font-bold text-[var(--ink)] mb-1">Cancelar reserva</h2>
            <p className="text-center text-xs text-[var(--muted)] mb-4">
              Se quemará el Rent NFT y el slot volverá a Available. Recibirás el rentPrice de vuelta.
            </p>

            {/* Summary */}
            <div className="rounded-xl border border-[var(--line)] p-3 mb-4 space-y-0">
              <SummaryRow label="Cancha"        value={fieldName} />
              <SummaryRow label="Horario"       value={`${fmtDate(datum.slotStart)} → ${fmtDate(datum.slotEnd)}`} />
              <SummaryRow label="UTxO ref"      value={`${slot.txHash.slice(0,8)}…#${slot.outputIndex}`} />
              <SummaryRow label="Redeemer"      value="Constr 2 · CancelRent" />
              <SummaryRow label="Lovelace"      value={`${slot.lovelace.toString()}`} />
              <SummaryRow label="Burn token"    value={nftLabel ?? datum.rentNFTName ?? '—'} />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowCancelModal(false)}
                disabled={loadingCancel}
                className="flex-1 py-2.5 rounded-[10px] border border-[var(--line)] text-sm font-semibold text-[var(--ink-2)] hover:border-[var(--line-strong)] disabled:opacity-40"
              >
                Volver
              </button>
              <button
                onClick={handleCancel}
                disabled={loadingCancel}
                className="flex-1 py-2.5 rounded-[10px] bg-[var(--rose-ink)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {loadingCancel && (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                )}
                Firmar Tx 6
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Dispute Modal (Tx 7) ───────────────────────────────────── */}
      {showDisputeModal && (
        <Modal onClose={() => setShowDisputeModal(false)}>
          <div className="p-5">
            {/* Icon */}
            <div className="w-11 h-11 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                  stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="12" y1="9" x2="12" y2="13" stroke="#d97706" strokeWidth="2" strokeLinecap="round"/>
                <line x1="12" y1="17" x2="12.01" y2="17" stroke="#d97706" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <h2 className="text-center font-bold text-[var(--ink)] mb-1">Abrir disputa</h2>
            <p className="text-center text-xs text-[var(--muted)] mb-4">
              El slot pasa a Disputed. Los fondos quedan bloqueados hasta que la compañía resuelva.
            </p>

            {/* Summary */}
            <div className="rounded-xl border border-[var(--line)] p-3 mb-3 space-y-0">
              <SummaryRow label="Cancha"       value={fieldName} />
              <SummaryRow label="Slot end"     value={fmtDate(datum.slotEnd)} />
              <SummaryRow label="UTxO ref"     value={`${slot.txHash.slice(0,8)}…#${slot.outputIndex}`} />
              <SummaryRow label="Redeemer"     value="Constr 3 · OpenDispute" />
              <SummaryRow label="Nuevo datum"  value="status → Disputed, depositDispute = 10 ADA" />
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-4 text-xs text-amber-800">
              Se bloquean 10 ADA adicionales como depósito de disputa. Se devuelven si la disputa se resuelve a tu favor.
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowDisputeModal(false)}
                disabled={loadingDispute}
                className="flex-1 py-2.5 rounded-[10px] border border-[var(--line)] text-sm font-semibold text-[var(--ink-2)] hover:border-[var(--line-strong)] disabled:opacity-40"
              >
                Volver
              </button>
              <button
                onClick={handleDispute}
                disabled={loadingDispute}
                className="flex-1 py-2.5 rounded-[10px] bg-amber-500 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {loadingDispute && (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                )}
                Firmar Tx 7 — bloquear 10 ₳
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Redeem Modal (Tx 8) ────────────────────────────────────── */}
      {showRedeemModal && (
        <Modal onClose={() => setShowRedeemModal(false)}>
          <div className="p-5">
            {/* Icon */}
            <div className="w-11 h-11 rounded-full bg-[var(--mint-bg)] flex items-center justify-center mx-auto mb-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" stroke="var(--mint-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <polyline points="22 4 12 14.01 9 11.01" stroke="var(--mint-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h2 className="text-center font-bold text-[var(--ink)] mb-1">Redimir NFT en cancha</h2>
            <p className="text-center text-xs text-[var(--muted)] mb-4">
              Se quemará tu Rent NFT y todos los fondos se enviarán al dueño de la cancha.
            </p>

            {/* Summary */}
            <div className="rounded-xl border border-[var(--line)] p-3 mb-4 space-y-0">
              <SummaryRow label="Cancha"        value={fieldName} />
              <SummaryRow label="Horario"       value={`${fmtDate(datum.slotStart)} → ${fmtDate(datum.slotEnd)}`} />
              <SummaryRow label="UTxO ref"      value={`${slot.txHash.slice(0,8)}…#${slot.outputIndex}`} />
              <SummaryRow label="Redeemer"      value="Constr 4 · RedeemAtField" />
              <SummaryRow label="Output owner"  value={shortenAddr(decodeBBS(datum.paymentAddress), 16, 6)} />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowRedeemModal(false)}
                disabled={loadingRedeem}
                className="flex-1 py-2.5 rounded-[10px] border border-[var(--line)] text-sm font-semibold text-[var(--ink-2)] hover:border-[var(--line-strong)] disabled:opacity-40"
              >
                Volver
              </button>
              <button
                onClick={handleRedeem}
                disabled={loadingRedeem}
                className="flex-1 py-2.5 rounded-[10px] bg-[var(--mint-ink)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {loadingRedeem && (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                )}
                Firmar Tx 8
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
