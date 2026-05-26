// react/OwnerRecordCard.tsx
// Renders an OwnerRecord (one per registered field-owner).
// Used in: Owner Panel (header), Discovery (owner detail), admin tools.

import * as React from 'react';
import type { OwnerRecord, PubKeyHash } from './types';
import { decodeBBS, parseLatLong, shortenAddr } from './lib';
import { PkhPill, AssetName, Label, KV } from './atoms';

export interface OwnerRecordCardProps {
  record: OwnerRecord;
  viewerPkh?: PubKeyHash;
  /** Show the "Update info" action — wires to Tx 10. */
  onUpdateInfo?: () => void;
  /** Collect payments — Tx 9. */
  onCollectPayments?: () => void;
}

export function OwnerRecordCard({
  record,
  viewerPkh,
  onUpdateInfo,
  onCollectPayments,
}: OwnerRecordCardProps) {
  const isOwner = viewerPkh && record.ownerPkh === viewerPkh;
  const geo = parseLatLong(record.lat, record.long);

  return (
    <article className="rounded-[14px] border border-[var(--line)] bg-[var(--paper)] overflow-hidden shadow-[0_1px_2px_rgba(20,16,8,.04)]">
      {/* Header */}
      <header className="px-5 py-4 border-b border-[var(--line)] flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-bold text-[20px] tracking-tight leading-tight">
            {decodeBBS(record.fieldName)}
          </h3>
          <p className="text-[13px] text-[var(--muted)] mt-0.5">
            {decodeBBS(record.address)}
          </p>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <PkhPill pkh={record.ownerPkh} nickname={isOwner ? 'tú' : undefined} dot={isOwner ? 'self' : null} />
            <AssetName tokenName={record.ownerNFTName} />
          </div>
        </div>
      </header>

      {/* On-chain stats */}
      <div className="px-5 py-4 grid grid-cols-4 gap-3 bg-[var(--paper-2)]">
        <Stat label="Completados" value={record.rentalsCompleted} />
        <Stat label="Reembolsos" value={record.rentalsRefunded} />
        <Stat label="Disputas" value={record.rentalsDisputed} variant={record.rentalsDisputed > 0 ? 'warn' : undefined} />
        <Stat label="NFTs probados" value={record.rentNFTsProven} />
      </div>

      {/* Contact + geo */}
      <div className="px-5 py-4 grid grid-cols-2 gap-4 text-[13px]">
        <div>
          <Label>contact</Label>
          <p className="mt-1.5 text-[var(--ink-2)]">{decodeBBS(record.phone)}</p>
          <p className="text-[var(--ink-2)]">{decodeBBS(record.email)}</p>
        </div>
        <div>
          <Label>paymentAddress</Label>
          <p className="mt-1.5 font-mono text-[12px] text-[var(--ink-2)] break-all">
            {shortenAddr(decodeBBS(record.paymentAddress), 12, 6)}
          </p>
        </div>
        {geo && (
          <div className="col-span-2">
            <Label>geo</Label>
            <p className="mt-1.5 font-mono text-[12px] text-[var(--ink-2)]">
              {geo.lat.toFixed(4)}, {geo.long.toFixed(4)}
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      {(onUpdateInfo || onCollectPayments) && isOwner && (
        <footer className="px-5 py-3 border-t border-[var(--line)] flex justify-end gap-2 bg-[var(--paper-2)]">
          {onUpdateInfo && (
            <button
              onClick={onUpdateInfo}
              className="px-3.5 py-2 rounded-[10px] text-[12px] font-semibold border border-[var(--line-strong)] bg-[var(--paper)] hover:border-[var(--ink-2)]"
            >
              Editar info · Tx 10
            </button>
          )}
          {onCollectPayments && (
            <button
              onClick={onCollectPayments}
              className="px-3.5 py-2 rounded-[10px] text-[12px] font-semibold border border-[var(--accent)] bg-[var(--accent)] text-white hover:bg-[var(--accent-deep)]"
            >
              Cobrar pagos · Tx 9
            </button>
          )}
        </footer>
      )}
    </article>
  );
}

// ───────────────────────────────────────────────────────────────────

function Stat({ label, value, variant }: { label: string; value: number; variant?: 'warn' }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)] font-semibold">
        {label}
      </div>
      <div
        className={[
          'mt-1 font-mono font-bold text-[22px] tracking-tight tabular-nums leading-none',
          variant === 'warn' && value > 0 ? 'text-[#6f2920]' : 'text-[var(--ink)]',
        ].filter(Boolean).join(' ')}
      >
        {value}
      </div>
    </div>
  );
}
