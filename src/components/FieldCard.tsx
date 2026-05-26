// FieldCard.tsx
// Card individual de una cancha en la grilla de FieldDiscovery.

import * as React from 'react';
import type { FieldSummary } from './types';
import { decodeBBS, shortenAddr } from './lib';
import { PriceAda } from './atoms';

export interface FieldCardProps {
  field: FieldSummary;
  onOpen?: (ownerNFTName: string) => void;
  compact?: boolean;
  className?: string;
}

const GRADIENT_IDS = ['fc-a', 'fc-b', 'fc-c', 'fc-d', 'fc-e', 'fc-f', 'fc-g', 'fc-h'] as const;
type GradId = (typeof GRADIENT_IDS)[number];

function gradientFor(ownerNFTName: string): GradId {
  let h = 0;
  for (let i = 0; i < ownerNFTName.length; i++) h = (h * 31 + ownerNFTName.charCodeAt(i)) >>> 0;
  return GRADIENT_IDS[h % GRADIENT_IDS.length];
}

export function FieldCard({ field, onOpen, compact = false, className = '' }: FieldCardProps) {
  const slots = field.slotsAvailable;
  const handleOpen = () => onOpen?.(field.ownerNFTName);

  return (
    <article
      className={[
        'group relative flex flex-col overflow-hidden',
        'bg-[var(--paper)] border border-[var(--line)] rounded-[14px]',
        'transition-all duration-150',
        'hover:-translate-y-[2px] hover:border-[var(--line-strong)]',
        'hover:shadow-[0_1px_2px_rgba(20,16,8,.04),0_6px_18px_rgba(20,16,8,.06)]',
        className,
      ].join(' ')}
    >
      {!compact && <FieldCover ownerNFTName={field.ownerNFTName} slotsAvailable={slots} />}

      <div className="flex flex-col gap-2.5 px-[18px] pt-4 pb-[18px]">
        <h3 className="m-0 text-[17px] font-semibold leading-tight tracking-[-0.012em] text-[var(--ink)]">
          {decodeBBS(field.fieldName)}
        </h3>

        <div className="flex items-start gap-1.5 text-[13px] leading-snug text-[var(--muted)]">
          <PinIcon />
          <span>{decodeBBS(field.fieldAddress)}</span>
        </div>

        <div className="h-px bg-[var(--line)] my-1" />

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-1">
            <PriceAda
              value={field.rentPrice}
              decimals={0}
              showSymbol={false}
              mono={false}
              className="text-[22px] font-bold tracking-[-0.02em] text-[var(--accent)]"
            />
            <span className="text-[14px] font-semibold text-[var(--accent)]">₳</span>
            <span className="text-[13px] text-[var(--muted)] ml-1">/ hora</span>
          </div>
          <SlotsPill count={slots} />
        </div>

        <button
          type="button"
          onClick={handleOpen}
          className={[
            'mt-1 w-full flex items-center justify-center gap-2',
            'bg-[var(--paper)] border border-[var(--ink)] text-[var(--ink)]',
            'rounded-[10px] px-3.5 py-[11px] text-[14px] font-semibold',
            'transition-colors',
            'hover:bg-[var(--ink)] hover:text-[var(--paper)]',
          ].join(' ')}
        >
          Ver cancha
          <svg
            width="14" height="14" viewBox="0 0 16 16" fill="none"
            className="transition-transform group-hover:translate-x-[2px]"
            aria-hidden="true"
          >
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </article>
  );
}

function FieldCover({ ownerNFTName, slotsAvailable }: { ownerNFTName: string; slotsAvailable: number }) {
  const grad = gradientFor(ownerNFTName);
  const hasSlots = slotsAvailable > 0;

  return (
    <div className="relative aspect-[16/10] bg-[var(--paper-2)] overflow-hidden">
      <svg viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full" aria-hidden="true">
        <defs>
          <CoverGradient id={grad} ownerNFTName={ownerNFTName} />
        </defs>
        <rect width="400" height="250" fill={`url(#${grad})`} />
        <rect x="40" y="40" width="320" height="170" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.4" />
        <line x1="200" y1="40" x2="200" y2="210" stroke="rgba(255,255,255,0.2)" strokeWidth="1.4" />
        <circle cx="200" cy="125" r="34" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.4" />
        <rect x="40" y="98" width="32" height="54" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.4" />
        <rect x="328" y="98" width="32" height="54" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.4" />
      </svg>

      <div className="absolute top-3 left-3">
        {hasSlots ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--mint)] text-[11px] font-semibold text-[#244d33] backdrop-blur-md">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--mint-deep)]" />
            {slotsAvailable} libres hoy
          </span>
        ) : (
          <span className="px-2.5 py-1 rounded-full bg-white/90 text-[11px] font-semibold text-[var(--ink)] backdrop-blur-md">
            Lleno hoy
          </span>
        )}
      </div>

      <span className="absolute top-3 right-3 px-2 py-1 rounded-md bg-[rgba(26,26,23,0.75)] backdrop-blur-sm text-[var(--paper)] font-mono text-[10px] font-medium tracking-wider">
        {shortenAddr(ownerNFTName, 6, 4)}
      </span>
    </div>
  );
}

function CoverGradient({ id, ownerNFTName }: { id: string; ownerNFTName: string }) {
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
  for (let i = 0; i < ownerNFTName.length; i++) h = (h * 31 + ownerNFTName.charCodeAt(i)) >>> 0;
  const [a, b] = palettes[h % palettes.length];
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor={a} />
      <stop offset="1" stopColor={b} />
    </linearGradient>
  );
}

function SlotsPill({ count }: { count: number }) {
  if (count === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded-full bg-[var(--paper-2)] text-[12px] font-semibold text-[var(--muted)]">
        Sin horarios
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded-full bg-[var(--mint)] text-[12px] font-semibold text-[#244d33]">
      <span className="font-mono">{count}</span>
      <span>slots disponibles</span>
    </span>
  );
}

function PinIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="mt-[2px] shrink-0 text-[var(--muted)]" aria-hidden="true">
      <path d="M8 14s4.5-4 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 10 8 14 8 14z" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="6.5" r="1.6" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
