import * as React from 'react'
import { useWallet } from '@meshsdk/react'
import { useOwnerRecord } from '../hooks/useOwnerRecord'
import { useRentSlots } from '../hooks/useRentSlots'
import { OwnerRecordCard } from '../components/OwnerRecordCard'
import { RentSlotRow } from '../components/RentSlotRow'
import { InitWeekModal } from '../components/InitWeekModal'
import { normalizeAddress } from '../lib/decoders'
import { addressToPkh } from '../hooks/useReserveSlot'

export default function OwnerPanel() {
  const { connected, wallet } = useWallet()
  const [ownerPkh, setOwnerPkh] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!connected || !wallet) { setOwnerPkh(null); return }
    wallet.getChangeAddress()
      .then(addr => setOwnerPkh(addressToPkh(normalizeAddress(addr))))
      .catch(() => setOwnerPkh(null))
  }, [connected, wallet])

  const { record, loading: loadingRecord } = useOwnerRecord(ownerPkh)
  const { slots, loading: loadingSlots }   = useRentSlots(record?.ownerNFTName)

  const [initWeekOpen, setInitWeekOpen] = React.useState(false)

  if (!connected) return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center">
      <p className="text-[var(--muted)]">Conecta tu wallet para ver tu panel de propietario.</p>
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

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6">
      <OwnerRecordCard
        record={record}
        viewerPkh={ownerPkh ?? undefined}
        onUpdateInfo={() => alert('Tx 10 — próximamente')}
        onCollectPayments={() => alert('Tx 9 — próximamente')}
      />

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
            <RentSlotRow key={s.txHash + '#' + s.outputIndex} datum={s.datum} />
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
