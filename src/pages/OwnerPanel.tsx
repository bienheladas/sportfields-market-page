import * as React from 'react'
import { useLucid } from '../lib/LucidContext'
import { useOwnerRecord } from '../hooks/useOwnerRecord'
import { useRentSlots } from '../hooks/useRentSlots'
import { useCollectSlot } from '../hooks/useCollectSlot'
import { OwnerRecordCard } from '../components/OwnerRecordCard'
import { RentSlotRow } from '../components/RentSlotRow'
import { InitWeekModal } from '../components/InitWeekModal'
import type { RentSlotUtxo } from '../hooks/useRentSlots'

export default function OwnerPanel() {
  const { connected, pkh: ownerPkh } = useLucid()

  const { record, loading: loadingRecord } = useOwnerRecord(ownerPkh || null)
  const { slots, loading: loadingSlots, reload }   = useRentSlots(record?.ownerNFTName)

  const [initWeekOpen, setInitWeekOpen] = React.useState(false)
  const { collectSlot, loading: collecting, error: collectError } = useCollectSlot()
  const [collectTxHash, setCollectTxHash] = React.useState<string | null>(null)

  if (!connected) return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center">
      <p className="text-[var(--muted)]">Conectá tu wallet para ver tu panel de propietario.</p>
    </div>
  )

  if (loadingRecord) return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center">
      <p className="text-[var(--muted)]">Buscando tu NFT de propietario…</p>
    </div>
  )

  if (!record) return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center">
      <p className="text-[var(--muted)] mb-4">No se encontró un Owner NFT para esta wallet.</p>
      <a href="/register" className="inline-block px-4 py-2 rounded-[10px] bg-[var(--accent)] text-white font-semibold text-sm">
        Registrarse como propietario
      </a>
    </div>
  )

  const completedSlots = slots.filter(s => s.datum.status === 'Completed')

  const handleCollect = async (slot: RentSlotUtxo) => {
    try {
      const txHash = await collectSlot(slot)
      setCollectTxHash(txHash)
      setTimeout(() => reload(), 3_000)
    } catch { /* error shown in collectError */ }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6">
      <OwnerRecordCard
        record={record}
        viewerPkh={ownerPkh ?? undefined}
        onUpdateInfo={() => alert('Tx 10 — próximamente')}
        onCollectPayments={() => alert('Tx 9 — próximamente')}
      />

      {collectError && (
        <div className="px-4 py-3 rounded-[10px] bg-[var(--rose-bg)] border border-[#ecb5ac] text-[var(--rose-ink)] text-sm">
          Error al cobrar: {collectError}
        </div>
      )}
      {collectTxHash && (
        <div className="px-4 py-3 rounded-[10px] bg-[var(--mint-bg)] border border-[#b9d8c1] text-[#244d33] text-sm flex items-center justify-between">
          <span>¡Cobro exitoso! Tx: <span className="font-mono">{collectTxHash.slice(0, 12)}…</span></span>
          <button onClick={() => setCollectTxHash(null)} className="text-[var(--muted)] hover:text-[var(--ink)] ml-2">✕</button>
        </div>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[18px] font-semibold">Mis slots</h2>
          <button
            type="button"
            onClick={() => setInitWeekOpen(true)}
            className="px-3.5 py-2 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-deep)] text-white font-semibold text-[13px] inline-flex items-center gap-1.5"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Programar semana
          </button>
        </div>
        {loadingSlots && <p className="text-[var(--muted)] text-sm">Cargando slots…</p>}
        <div className="flex flex-col gap-2">
          {slots.map(s => (
            <div key={s.txHash + '#' + s.outputIndex}>
              <RentSlotRow datum={s.datum} />
              {s.datum.status === 'Completed' && (
                <button
                  type="button"
                  disabled={collecting}
                  onClick={() => handleCollect(s)}
                  className="mt-1 px-3 py-1.5 rounded-[8px] text-xs font-semibold border border-[var(--mint-ink)] text-[var(--mint-ink)] bg-[var(--mint-bg)] hover:opacity-80 disabled:opacity-40"
                >
                  {collecting ? 'Cobrando…' : 'Cobrar slot (Tx 9)'}
                </button>
              )}
            </div>
          ))}
        </div>
        {!loadingSlots && slots.length === 0 && (
          <p className="text-[var(--muted)] text-sm">No hay slots para esta semana.</p>
        )}
      </section>

      {record && (
        <InitWeekModal
          record={record}
          open={initWeekOpen}
          onClose={() => setInitWeekOpen(false)}
          onDone={() => setInitWeekOpen(false)}
        />
      )}
    </div>
  )
}
