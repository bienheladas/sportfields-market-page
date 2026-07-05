// react/OwnerInfoForm.tsx
// Form for Tx 10 (UpdateOwnerInfo). Only mutable fields per the validator:
//   fieldName · address · phone · email · lat · long · paymentAddress · timezone
// Immutable fields (ownerPkh, ownerNFTName, all stats) are NOT editable here —
// the validator rejects any tx that tries to change them. timezone (Mejora L)
// is not constrained by check_update_owner_info either, so it's editable too —
// important since it anchors the weekly schedule (see init-week.mjs / useInitWeek.ts).

import * as React from 'react';
import type { OwnerRecord } from './types';
import { decodeBBS } from './lib';
import { timezoneFromLatLong } from '../lib/timezone';
import { Label } from './atoms';

const LATLONG_RE = /^-?\d+\.?\d*$/;

export interface OwnerInfoFormProps {
  /** Current on-chain record (decoded). */
  record: OwnerRecord;
  /** Called with the new mutable fields when the user clicks "Firmar Tx 10". */
  onSubmit: (patch: MutableOwnerFields) => void;
  /** Disable while a Tx is in flight. */
  submitting?: boolean;
}

/** Subset of OwnerRecord the validator allows to mutate. */
export interface MutableOwnerFields {
  fieldName: string;
  address: string;
  phone: string;
  email: string;
  lat: string;
  long: string;
  paymentAddress: string;
  timezone: string;
}

export function OwnerInfoForm({ record, onSubmit, submitting }: OwnerInfoFormProps) {
  const [draft, setDraft] = React.useState<MutableOwnerFields>(() => ({
    fieldName: decodeBBS(record.fieldName),
    address: decodeBBS(record.address),
    phone: decodeBBS(record.phone),
    email: decodeBBS(record.email),
    lat: decodeBBS(record.lat),
    long: decodeBBS(record.long),
    paymentAddress: decodeBBS(record.paymentAddress),
    timezone: decodeBBS(record.timezone),
  }));

  // timezone se deriva de lat/long en el propio setter (no es un campo libre) —
  // ver nota en RegisterOwner.tsx sobre por qué texto libre quedó desincronizado
  // de la ubicación real de la cancha.
  function set<K extends keyof MutableOwnerFields>(k: K, v: MutableOwnerFields[K]) {
    setDraft((d) => {
      const next = { ...d, [k]: v };
      if (k === 'lat' || k === 'long') {
        next.timezone = LATLONG_RE.test(next.lat) && LATLONG_RE.test(next.long)
          ? timezoneFromLatLong(parseFloat(next.lat), parseFloat(next.long))
          : d.timezone;
      }
      return next;
    });
  }

  const dirty = (Object.keys(draft) as (keyof MutableOwnerFields)[]).some(
    (k) => draft[k] !== decodeBBS(record[k as keyof OwnerRecord] as string),
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft);
      }}
      className="rounded-[14px] border border-[var(--line)] bg-[var(--paper)] overflow-hidden"
    >
      <header className="px-5 py-4 border-b border-[var(--line)]">
        <Label>Tx 10 · UpdateOwnerInfo</Label>
        <h3 className="mt-1 font-bold text-[18px] tracking-tight">Editar información del campo</h3>
        <p className="text-[12px] text-[var(--muted)] mt-1 leading-relaxed">
          Sólo se pueden cambiar los campos editables. Las estadísticas
          (<code>rentalsCompleted</code>, <code>rentalsDisputed</code>…) y el <code>ownerPkh</code> son
          inmutables en este redeemer.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 px-5 py-4">
        <Field label="fieldName" value={draft.fieldName} onChange={(v) => set('fieldName', v)} />
        <Field label="phone" value={draft.phone} onChange={(v) => set('phone', v)} />
        <Field label="address" value={draft.address} onChange={(v) => set('address', v)} fullWidth />
        <Field label="email" value={draft.email} onChange={(v) => set('email', v)} type="email" />
        <Field label="paymentAddress" value={draft.paymentAddress} onChange={(v) => set('paymentAddress', v)} mono />
        <Field label="lat (BBS)" value={draft.lat} onChange={(v) => set('lat', v)} mono />
        <Field label="long (BBS)" value={draft.long} onChange={(v) => set('long', v)} mono />
        <div className="col-span-2 flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--muted)] font-semibold">
            timezone (derivado de lat/long)
          </span>
          <div className="px-3 py-2 rounded-[8px] border border-dashed border-[var(--line-strong)] bg-[var(--paper-2)] text-[13px] font-mono text-[var(--ink-2)]">
            {draft.timezone || '—'}
          </div>
        </div>
      </div>
      <p className="px-5 -mt-2 pb-3 text-[11px] text-[var(--muted)] leading-relaxed">
        El horario de la semana (init-week) se ancla a medianoche en esta zona horaria, no UTC.
        Cambiarla (editando lat/long) no afecta semanas ya inicializadas — solo aplica a las próximas.
      </p>

      <footer className="px-5 py-3 border-t border-[var(--line)] bg-[var(--paper-2)] flex justify-end gap-2">
        <button
          type="button"
          onClick={() =>
            setDraft({
              fieldName: decodeBBS(record.fieldName),
              address: decodeBBS(record.address),
              phone: decodeBBS(record.phone),
              email: decodeBBS(record.email),
              lat: decodeBBS(record.lat),
              long: decodeBBS(record.long),
              paymentAddress: decodeBBS(record.paymentAddress),
              timezone: decodeBBS(record.timezone),
            })
          }
          disabled={!dirty || submitting}
          className="px-3.5 py-2 rounded-[10px] text-[12px] font-semibold border border-[var(--line-strong)] bg-[var(--paper)] disabled:opacity-50"
        >
          Descartar
        </button>
        <button
          type="submit"
          disabled={!dirty || submitting}
          className="px-3.5 py-2 rounded-[10px] text-[12px] font-semibold bg-[var(--accent)] text-white border border-[var(--accent)] hover:bg-[var(--accent-deep)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? 'Firmando…' : 'Firmar Tx 10'}
        </button>
      </footer>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  mono,
  fullWidth,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  mono?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <label className={['flex flex-col gap-1.5', fullWidth ? 'col-span-2' : ''].join(' ')}>
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--muted)] font-semibold">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={[
          'px-3 py-2 rounded-[8px] border border-[var(--line-strong)] bg-[var(--paper)]',
          'text-[13px] outline-none focus:border-[var(--ink-2)]',
          mono ? 'font-mono' : '',
        ].join(' ')}
      />
    </label>
  );
}
