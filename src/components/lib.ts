// react/lib.ts
// Pure helpers: format Lovelace as ADA, POSIXTime as date, decode slot 1..168.

import type { Lovelace, POSIXTime, PubKeyHash, TokenName, BBS } from './types';

// ───────────────────────────────────────────────────────────────────
// Lovelace ↔ ADA
// ───────────────────────────────────────────────────────────────────

export const LOVELACE_PER_ADA = 1_000_000n;

export function lovelaceToAda(l: Lovelace): number {
  // safe for amounts up to ~9 quadrillion ADA; use bigint math first then narrow
  const whole = l / LOVELACE_PER_ADA;
  const frac = Number(l % LOVELACE_PER_ADA) / 1_000_000;
  return Number(whole) + frac;
}

export function adaToLovelace(ada: number): Lovelace {
  return BigInt(Math.round(ada * 1_000_000));
}

export function formatAda(l: Lovelace, opts: { decimals?: number; symbol?: boolean } = {}): string {
  const ada = lovelaceToAda(l);
  const decimals = opts.decimals ?? 2;
  const num = ada.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return opts.symbol === false ? num : `${num} ₳`;
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

// ───────────────────────────────────────────────────────────────────
// POSIXTime
// ───────────────────────────────────────────────────────────────────

export function posixToDate(t: POSIXTime): Date {
  return new Date(t);
}

const DAY_LABELS_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DAY_LABELS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export type Lang = 'es' | 'en';

export function formatSlotRange(start: POSIXTime, end: POSIXTime, lang: Lang = 'es'): string {
  const s = new Date(start);
  const e = new Date(end);
  const days = lang === 'es' ? DAY_LABELS_ES : DAY_LABELS_EN;
  const day = days[(s.getDay() + 6) % 7]; // make Monday index 0
  const hs = String(s.getHours()).padStart(2, '0');
  const he = String(e.getHours()).padStart(2, '0');
  return `${day} ${s.getDate()} · ${hs}:00–${he}:00`;
}

export function formatPosixDateTime(t: POSIXTime, lang: Lang = 'es'): string {
  const d = new Date(t);
  return d.toLocaleString(lang === 'es' ? 'es-AR' : 'en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ───────────────────────────────────────────────────────────────────
// Slot 1..168 utilities
// ───────────────────────────────────────────────────────────────────

/** Slot 1 = Mon 00:00–01:00, Slot 168 = Sun 23:00–00:00. */
export interface SlotCoord {
  /** 0 = Mon … 6 = Sun */
  day: number;
  /** 0..23 */
  hour: number;
}

export function slotIdToCoord(slotId: number): SlotCoord {
  if (slotId < 1 || slotId > 168) throw new Error(`slotId out of range: ${slotId}`);
  const zeroBased = slotId - 1;
  return { day: Math.floor(zeroBased / 24), hour: zeroBased % 24 };
}

export function coordToSlotId(c: SlotCoord): number {
  return c.day * 24 + c.hour + 1;
}

export function slotIdLabel(slotId: number, lang: Lang = 'es'): string {
  const { day, hour } = slotIdToCoord(slotId);
  const days = lang === 'es' ? DAY_LABELS_ES : DAY_LABELS_EN;
  const hs = String(hour).padStart(2, '0');
  const he = String((hour + 1) % 24).padStart(2, '0');
  return `${days[day]} · ${hs}:00–${he}:00`;
}

// ───────────────────────────────────────────────────────────────────
// Address & TokenName display
// ───────────────────────────────────────────────────────────────────

/** Shorten a hex PKH or bech32 addr for display: `addr1q…a8s2`. */
export function shortenAddr(addr: PubKeyHash | string, head = 8, tail = 4): string {
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** Decode a hex TokenName to UTF-8 if it round-trips cleanly; otherwise return as-is. */
export function decodeTokenName(tn: TokenName): string {
  // Best effort — TokenName may be raw hex bytes. If looks like ASCII-only after decoding, use it.
  if (/^[0-9a-fA-F]+$/.test(tn) && tn.length % 2 === 0) {
    try {
      const bytes = new Uint8Array(tn.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(tn.slice(i * 2, i * 2 + 2), 16);
      }
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (/^[\x20-\x7E]+$/.test(decoded)) return decoded;
    } catch {
      /* fallthrough */
    }
  }
  return tn;
}

/** Decode an on-chain BuiltinByteString to UTF-8 text for display. */
export function decodeBBS(bbs: BBS): string {
  return decodeTokenName(bbs);
}

// ───────────────────────────────────────────────────────────────────
// Geo (lat/long are BBS in datums — decode to numbers when displaying)
// ───────────────────────────────────────────────────────────────────

export function parseLatLong(lat: BBS, long: BBS): { lat: number; long: number } | null {
  const a = parseFloat(decodeBBS(lat));
  const b = parseFloat(decodeBBS(long));
  if (Number.isFinite(a) && Number.isFinite(b)) return { lat: a, long: b };
  return null;
}
