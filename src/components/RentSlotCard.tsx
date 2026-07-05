// react/RentSlotCard.tsx
// Renders a single RentDatum as a full-detail card. Used in:
// - Reservation Summary (one slot per row)
// - My Bookings expand view
// - Admin tools

import * as React from 'react';
import type { RentDatum, PubKeyHash } from './types';
import {
  formatAda,
  formatBps,
  formatPosixDateTime,
  slotIdLabel,
  decodeBBS,
  parseLatLong,
  shortenAddr,
} from './lib';
import {
  PriceAda,
  PkhPill,
  AssetName,
  SlotStatusBadge,
  Label,
  KV,
} from './atoms';

export interface RentSlotCardProps {
  datum: RentDatum;
  /** PKH of the currently connected wallet — highlights ownership badges. */
  viewerPkh?: PubKeyHash;
  /** Render compact (collapses metadata block). */
  compact?: boolean;
  /** Slot-action callbacks (each builds the relevant Tx). Omit to hide buttons. */
  onReserve?: () => void;
  onConfirmRent?: () => void;
  onCancelRent?: () => void;
  onRedeemAtField?: () => void;
  onOpenDispute?: () => void;
  /** Field's IANA timezone (OwnerRecord.timezone) — defaults to UTC if unknown. */
  timeZone?: string;
}

export function RentSlotCard({
  datum,
  viewerPkh,
  compact = false,
  onReserve,
  onConfirmRent,
  onCancelRent,
  onRedeemAtField,
  onOpenDispute,
  timeZone = 'UTC',
}: RentSlotCardProps) {
  const isCustomer = viewerPkh && datum.customerPkh === viewerPkh;
  const isOwner = viewerPkh && datum.ownerPkh === viewerPkh;
  const geo = parseLatLong(datum.lat, datum.long);

  return (
    <article className="rounded-[14px] border border-[var(--line)] bg-[var(--paper)] overflow-hidden shadow-[0_1px_2px_rgba(20,16,8,.04)]">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[var(--line)]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex flex-col items-center justify-center w-12 h-12 rounded-lg bg-[var(--paper-2)] border border-[var(--line)] flex-shrink-0">
            <span className="text-[9px] uppercase tracking-wider text-[var(--muted)] font-semibold leading-none">slot</span>
            <span className="font-mono text-[14px] font-bold leading-none mt-0.5">{datum.slotId}</span>
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-[15px] truncate">{decodeBBS(datum.fieldName)}</h3>
            <p className="text-[12px] text-[var(--muted)] truncate">
              {slotIdLabel(datum.slotId)} · {formatPosixDateTime(datum.slotStart, 'es', timeZone)}
            </p>
          </div>
        </div>
        <SlotStatusBadge status={datum.status} />
      </header>

      {/* Body */}
      <div className="px-5 py-4 flex flex-col gap-3">
        <div className="flex justify-between items-baseline">
          <Label>rentPrice</Label>
          <PriceAda value={datum.rentPrice} className="text-[22px] font-bold tracking-tight" />
        </div>

        {datum.disputeDeposit && (
          <div className="flex justify-between items-baseline">
            <Label>disputeDeposit (escrow)</Label>
            <PriceAda value={datum.disputeDeposit} className="text-[14px] font-semibold text-[#6f2920]" />
          </div>
        )}

        {/* Parties */}
        <div className="grid grid-cols-2 gap-2 mt-1">
          <div>
            <Label>owner</Label>
            <div className="mt-1.5">
              <PkhPill pkh={datum.ownerPkh} nickname={isOwner ? 'tú' : undefined} dot={isOwner ? 'self' : null} />
            </div>
          </div>
          {datum.customerPkh && (
            <div>
              <Label>customer</Label>
              <div className="mt-1.5">
                <PkhPill pkh={datum.customerPkh} nickname={isCustomer ? 'tú' : undefined} dot={isCustomer ? 'self' : null} />
              </div>
            </div>
          )}
        </div>

        {/* Rent NFT (if minted) */}
        {datum.rentNFTName && (
          <div className="flex items-center justify-between gap-3 pt-1">
            <Label>rentNFT</Label>
            <AssetName tokenName={datum.rentNFTName} />
          </div>
        )}

        {!compact && (
          <details className="mt-1 border-t border-dashed border-[var(--line-strong)] pt-3">
            <summary className="text-[12px] text-[var(--muted)] cursor-pointer font-medium">
              Detalles on-chain
            </summary>
            <div className="mt-3 flex flex-col gap-0.5">
              <KV label="slotStart" mono>{formatPosixDateTime(datum.slotStart, 'es', timeZone)}</KV>
              <KV label="slotEnd" mono>{formatPosixDateTime(datum.slotEnd, 'es', timeZone)}</KV>
              <KV label="cancelDeadline" mono>{formatPosixDateTime(datum.cancelDeadline, 'es', timeZone)}</KV>
              <KV label="siteCommission" mono>{formatBps(datum.siteCommissionBps)}</KV>
              <KV label="ownerNFT" mono>
                <AssetName tokenName={datum.ownerNFTName} variant="inline" glyph={false} />
              </KV>
              <KV label="companyPkh" mono>{shortenAddr(datum.companyPkh)}</KV>
              <KV label="paymentAddress" mono>{shortenAddr(decodeBBS(datum.paymentAddress))}</KV>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
              <div>
                <Label>address</Label>
                <p className="mt-1 text-[var(--ink-2)]">{decodeBBS(datum.fieldAddress)}</p>
              </div>
              <div>
                <Label>contact</Label>
                <p className="mt-1 text-[var(--ink-2)]">{decodeBBS(datum.phone)}</p>
                <p className="text-[var(--ink-2)]">{decodeBBS(datum.email)}</p>
              </div>
            </div>

            {geo && (
              <div className="mt-3">
                <Label>geo (rdLat, rdLong)</Label>
                <p className="mt-1 font-mono text-[12px] text-[var(--ink-2)]">
                  {geo.lat.toFixed(4)}, {geo.long.toFixed(4)}
                </p>
              </div>
            )}
          </details>
        )}
      </div>

      {/* Actions footer (only show buttons whose Tx is valid in current state) */}
      {(onReserve || onConfirmRent || onCancelRent || onRedeemAtField || onOpenDispute) && (
        <footer className="px-5 py-3 border-t border-[var(--line)] flex gap-2 justify-end flex-wrap bg-[var(--paper-2)]">
          {datum.status === 'Available' && onReserve && (
            <ActionBtn variant="primary" onClick={onReserve}>
              Reservar · Tx 4
            </ActionBtn>
          )}
          {datum.status === 'Pending' && isCustomer && onConfirmRent && (
            <ActionBtn variant="primary" onClick={onConfirmRent}>
              Mintear Rent NFT · Tx 5
            </ActionBtn>
          )}
          {(datum.status === 'Pending' || datum.status === 'Confirmed') && isCustomer && onCancelRent && (
            <ActionBtn onClick={onCancelRent}>Cancelar · Tx 6 (−2 ₳)</ActionBtn>
          )}
          {datum.status === 'Confirmed' && isCustomer && onRedeemAtField && (
            <ActionBtn variant="primary" onClick={onRedeemAtField}>
              Redimir en cancha · Tx 8
            </ActionBtn>
          )}
          {datum.status === 'Confirmed' && isCustomer && onOpenDispute && (
            <ActionBtn onClick={onOpenDispute}>Abrir disputa · Tx 7 (+50 ₳)</ActionBtn>
          )}
        </footer>
      )}
    </article>
  );
}

// ───────────────────────────────────────────────────────────────────
// Internal: action button
// ───────────────────────────────────────────────────────────────────

function ActionBtn({
  children,
  variant = 'default',
  onClick,
}: {
  children: React.ReactNode;
  variant?: 'default' | 'primary';
  onClick?: () => void;
}) {
  const base =
    'inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-[10px] font-semibold text-[12px] border';
  const styles =
    variant === 'primary'
      ? 'bg-[var(--accent)] text-white border-[var(--accent)] hover:bg-[var(--accent-deep)]'
      : 'bg-[var(--paper)] text-[var(--ink)] border-[var(--line-strong)] hover:border-[var(--ink-2)]';
  return (
    <button onClick={onClick} className={`${base} ${styles}`}>
      {children}
    </button>
  );
}
