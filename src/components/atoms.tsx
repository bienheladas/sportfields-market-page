// react/atoms.tsx
// Small reusable components that render Plutus primitives.
// Tailwind v3+ with arbitrary value support (var(--*)) recommended.

import * as React from 'react';
import type { Lovelace, PubKeyHash, TokenName, SlotStatus, AssetClass } from './types';
import { formatAda, shortenAddr, decodeTokenName } from './lib';

// ───────────────────────────────────────────────────────────────────
// PriceAda — formats a Lovelace amount as ADA
// ───────────────────────────────────────────────────────────────────

export interface PriceAdaProps {
  value: Lovelace;
  decimals?: number;
  showSymbol?: boolean;
  className?: string;
  /** Use the design system's mono font (recommended for tabular amounts). */
  mono?: boolean;
}

export function PriceAda({
  value,
  decimals = 2,
  showSymbol = true,
  mono = true,
  className = '',
}: PriceAdaProps) {
  return (
    <span
      className={[
        mono ? 'font-mono tabular-nums' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      {formatAda(value, { decimals, symbol: showSymbol })}
    </span>
  );
}

// ───────────────────────────────────────────────────────────────────
// PkhPill — short pill for a PubKeyHash / Bech32 address
// ───────────────────────────────────────────────────────────────────

export interface PkhPillProps {
  pkh: PubKeyHash;
  /** Optional nickname (renter, owner) shown before the address. */
  nickname?: string | null;
  /** Show a leading dot indicating "live" / "you" / "other". */
  dot?: 'live' | 'self' | 'muted' | null;
  className?: string;
}

const DOT_COLORS = {
  live: 'bg-[var(--mint-deep)] shadow-[0_0_0_3px_rgba(111,190,138,.18)]',
  self: 'bg-[var(--accent)]',
  muted: 'bg-[var(--muted)]',
};

export function PkhPill({ pkh, nickname, dot, className = '' }: PkhPillProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-2 px-2.5 py-1 rounded-full',
        'border border-[var(--line-strong)] bg-[var(--paper)] text-[13px]',
        className,
      ].join(' ')}
      title={pkh}
    >
      {dot && <span className={`w-2 h-2 rounded-full ${DOT_COLORS[dot]}`} />}
      {nickname && (
        <>
          <span className="font-medium text-[var(--ink)]">{nickname}</span>
          <span className="text-[var(--line-strong)]">·</span>
        </>
      )}
      <span className="font-mono text-[var(--ink-2)]">{shortenAddr(pkh)}</span>
    </span>
  );
}

// ───────────────────────────────────────────────────────────────────
// AssetName — displays a TokenName, decoded from hex when possible
// ───────────────────────────────────────────────────────────────────

export interface AssetNameProps {
  tokenName: TokenName;
  /** Optional policy id / currency symbol to disambiguate. */
  policyId?: string;
  /** Show a leading ⬢ glyph to mark "this is an NFT". */
  glyph?: boolean;
  variant?: 'inline' | 'pill';
  className?: string;
}

export function AssetName({
  tokenName,
  policyId,
  glyph = true,
  variant = 'pill',
  className = '',
}: AssetNameProps) {
  const decoded = decodeTokenName(tokenName);
  if (variant === 'inline') {
    return (
      <span className={`font-mono text-[12px] text-[var(--ink-2)] ${className}`} title={policyId ? `${policyId}.${tokenName}` : tokenName}>
        {glyph && <span className="text-[var(--accent)] mr-1">⬢</span>}
        {decoded}
      </span>
    );
  }
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md',
        'bg-gradient-to-br from-[var(--accent-soft)] to-[#fff3eb]',
        'border border-[var(--accent)] text-[var(--accent-deep)]',
        'font-mono text-[11px] font-semibold',
        className,
      ].join(' ')}
      title={policyId ? `${policyId}.${tokenName}` : tokenName}
    >
      {glyph && <span>⬢</span>}
      <span>{decoded}</span>
    </span>
  );
}

// ───────────────────────────────────────────────────────────────────
// SlotStatusBadge — renders RentDatum.status
// ───────────────────────────────────────────────────────────────────

export interface SlotStatusBadgeProps {
  status: SlotStatus;
  size?: 'sm' | 'md';
  className?: string;
}

const STATUS_CLASSES: Record<SlotStatus, string> = {
  Available: 'bg-[var(--mint-bg)] text-[#244d33]',
  Pending:   'bg-[var(--amber-bg)] text-[var(--amber-deep)]',
  Confirmed: 'bg-[var(--accent-soft)] text-[var(--accent-deep)]',
  Completed: 'bg-[var(--slate-bg)] text-[#2c4055]',
  Disputed:  'bg-[var(--rose-bg)] text-[#6f2920]',
};

const STATUS_LABEL_ES: Record<SlotStatus, string> = {
  Available: 'Disponible',
  Pending:   'Pendiente',
  Confirmed: 'Confirmada',
  Completed: 'Jugada',
  Disputed:  'En disputa',
};

export function SlotStatusBadge({ status, size = 'md', className = '' }: SlotStatusBadgeProps) {
  const sz = size === 'sm' ? 'text-[10px] px-2 py-[2px]' : 'text-[11px] px-2.5 py-[3px]';
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full font-mono font-semibold',
        STATUS_CLASSES[status],
        sz,
        className,
      ].join(' ')}
      title={status}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      {STATUS_LABEL_ES[status]}
    </span>
  );
}

// ───────────────────────────────────────────────────────────────────
// Label / KV row — tiny helpers used across the cards
// ───────────────────────────────────────────────────────────────────

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--muted)] font-semibold">
      {children}
    </span>
  );
}

export function KV({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between items-baseline gap-3 text-[13px] py-1">
      <span className="text-[var(--muted)]">{label}</span>
      <span className={mono ? 'font-mono text-[var(--ink-2)] text-[12px]' : 'text-[var(--ink)]'}>
        {children}
      </span>
    </div>
  );
}
