import * as React from 'react'
import { useLucid } from '../lib/LucidContext'
import { useRentSlots } from '../hooks/useRentSlots'
import { useCompanyConfig } from '../hooks/useCompanyConfig'
import { useResolveToCustomer } from '../hooks/useResolveToCustomer'
import { useResolveToOwner } from '../hooks/useResolveToOwner'
import { CompanyConfigCard } from '../components/CompanyConfigCard'
import { RentSlotRow } from '../components/RentSlotRow'
import { decodeBBS, formatAda } from '../components/lib'
import { useOwnerRecord } from '../hooks/useOwnerRecord'
import { COMPANY_PKH } from '../lib/config'
import type { RentSlotUtxo } from '../hooks/useRentSlots'

function DisputeRow({
  slot,
  onResolveCustomer,
  onResolveOwner,
  busy,
}: {
  slot: RentSlotUtxo
  onResolveCustomer: (s: RentSlotUtxo) => void
  onResolveOwner: (s: RentSlotUtxo) => void
  busy: boolean
}) {
  const d = slot.datum
  // Display slot times in the field's own timezone, not UTC/browser-local.
  // Must look up by ownerNFTName, not ownerPkh — see useOwnerRecord.ts.
  const { record: ownerRecord } = useOwnerRecord(d.ownerNFTName)
  return (
    <div className="rounded-[10px] border border-[var(--line)] p-3 flex flex-col gap-2">
      <RentSlotRow datum={d} timeZone={ownerRecord?.timezone} />
      <div className="flex flex-wrap gap-2 text-[11px] text-[var(--muted)]">
        <span>Cancha: {decodeBBS(d.fieldName)}</span>
        <span>· Depósito disputa: {d.disputeDeposit !== null ? formatAda(d.disputeDeposit) : '—'}</span>
        <span>· Rent price: {formatAda(d.rentPrice)}</span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolveCustomer(slot)}
          className="px-3 py-1.5 rounded-[8px] text-xs font-semibold border border-[var(--mint-ink)] text-[var(--mint-ink)] bg-[var(--mint-bg)] hover:opacity-80 disabled:opacity-40"
        >
          A favor del cliente
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolveOwner(slot)}
          className="px-3 py-1.5 rounded-[8px] text-xs font-semibold border border-[var(--line-strong)] text-[var(--ink-2)] hover:border-[var(--ink)] disabled:opacity-40"
        >
          A favor del owner
        </button>
      </div>
    </div>
  )
}

export default function CompanyPanel() {
  const { connected, pkh } = useLucid()
  const isCompany = connected && pkh === COMPANY_PKH

  const { config, loading: loadingConfig } = useCompanyConfig()
  const { slots, loading: loadingSlots, reload: reloadSlots } = useRentSlots()
  const disputed = slots.filter(s => s.datum.status === 'Disputed')

  const { resolveToCustomer, loading: resolvingCustomer, error: errCustomer } = useResolveToCustomer()
  const { resolveToOwner, loading: resolvingOwner, error: errOwner } = useResolveToOwner()
  const [txHash, setTxHash] = React.useState<string | null>(null)
  const busy = resolvingCustomer || resolvingOwner

  const handleResolveCustomer = async (slot: RentSlotUtxo) => {
    try {
      const hash = await resolveToCustomer(slot)
      setTxHash(hash)
      setTimeout(() => reloadSlots(), 3_000)
    } catch { /* error shown inline */ }
  }

  const handleResolveOwner = async (slot: RentSlotUtxo) => {
    try {
      const hash = await resolveToOwner(slot)
      setTxHash(hash)
      setTimeout(() => reloadSlots(), 3_000)
    } catch { /* error shown inline */ }
  }

  if (!connected) return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center">
      <p className="text-[var(--muted)]">Conecta la wallet de la company para ver este panel.</p>
    </div>
  )

  if (!isCompany) return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center">
      <p className="text-[var(--muted)]">Esta wallet no es la company — no tenés acceso a este panel.</p>
    </div>
  )

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-bold tracking-tight leading-tight">Panel de la company</h1>
        <p className="text-[var(--muted)] text-sm mt-1">
          Configuración global y resolución de disputas.
        </p>
      </div>

      {txHash && (
        <div className="px-4 py-3 rounded-[10px] bg-[var(--mint-bg)] border border-[#b9d8c1] text-[#244d33] text-sm flex items-center justify-between">
          <span>¡Tx enviada! <span className="font-mono">{txHash.slice(0, 16)}…</span></span>
          <button onClick={() => setTxHash(null)} className="text-[var(--muted)] hover:text-[var(--ink)] ml-2">✕</button>
        </div>
      )}
      {(errCustomer || errOwner) && (
        <div className="px-4 py-3 rounded-[10px] bg-[var(--rose-bg)] border border-[#ecb5ac] text-[var(--rose-ink)] text-sm">
          Error al resolver disputa: {errCustomer || errOwner}
        </div>
      )}

      {loadingConfig && <p className="text-[var(--muted)] text-sm">Cargando configuración…</p>}
      {config && <CompanyConfigCard config={config} />}

      <section>
        <h2 className="text-[18px] font-semibold mb-3">
          Disputas abiertas {disputed.length > 0 && `(${disputed.length})`}
        </h2>
        {loadingSlots && <p className="text-[var(--muted)] text-sm">Cargando…</p>}
        {!loadingSlots && disputed.length === 0 && (
          <p className="text-[var(--muted)] text-sm">No hay disputas abiertas.</p>
        )}
        <div className="flex flex-col gap-3">
          {disputed.map(s => (
            <DisputeRow
              key={s.txHash + '#' + s.outputIndex}
              slot={s}
              onResolveCustomer={handleResolveCustomer}
              onResolveOwner={handleResolveOwner}
              busy={busy}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
