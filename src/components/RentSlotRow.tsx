// react/RentSlotRow.tsx
// Compact, table-friendly row for a single RentDatum.
// Use in calendars, owner's "upcoming partidos" lists, and admin tables.

import * as React from 'react';
import type { RentDatum } from './types';
import { decodeBBS, slotIdLabel, formatPosixDateTime } from './lib';
import { PriceAda, SlotStatusBadge, AssetName } from './atoms';

export interface RentSlotRowProps {
  datum: RentDatum;
  onClick?: () => void;
  /** Highlight when this row matches the connected wallet's PKH. */
  highlight?: boolean;
  /** Field's IANA timezone (OwnerRecord.timezone) — defaults to UTC if unknown. */
  timeZone?: string;
}

export function RentSlotRow({ datum, onClick, highlight, timeZone = 'UTC' }: RentSlotRowProps) {
  return (
    <button
      onClick={onClick}
      className={[
        'w-full text-left rounded-[10px] grid items-center gap-3 px-3 py-2.5',
        'grid-cols-[40px_minmax(0,1fr)_auto_auto] hover:bg-[var(--paper-2)]',
        highlight ? 'bg-[var(--accent-soft)]' : 'bg-[var(--paper-2)]',
      ].join(' ')}
    >
      {/* slot id */}
      <span className="font-mono text-[12px] text-[var(--muted)] font-semibold tabular-nums text-center">
        #{datum.slotId}
      </span>

      {/* when + field */}
      <div className="min-w-0">
        <div className="text-[13px] font-medium truncate">
          {slotIdLabel(datum.slotId)}
        </div>
        <div className="text-[11px] text-[var(--muted)] truncate font-mono">
          {decodeBBS(datum.fieldName)} · {formatPosixDateTime(datum.slotStart, 'es', timeZone)}
        </div>
      </div>

      {/* price + (NFT if minted) */}
      <div className="flex flex-col items-end gap-1">
        <PriceAda value={datum.rentPrice} className="text-[13px] font-semibold" />
        {datum.rentNFTName && (
          <AssetName tokenName={datum.rentNFTName} variant="inline" />
        )}
      </div>

      {/* status */}
      <SlotStatusBadge status={datum.status} size="sm" />
    </button>
  );
}
