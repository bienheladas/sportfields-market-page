import * as React from 'react'
import { useLucid } from '../lib/LucidContext'
import { useOwnerFields } from '../hooks/useOwnerFields'
import { useRentSlots } from '../hooks/useRentSlots'
import { useCollectSlot } from '../hooks/useCollectSlot'
import { useDeinitWeek } from '../hooks/useDeinitWeek'
import { useUpdateOwnerInfo } from '../hooks/useUpdateOwnerInfo'
import { OwnerRecordCard } from '../components/OwnerRecordCard'
import { decodeBBS, formatAda } from '../components/lib'
import { OwnerInfoForm } from '../components/OwnerInfoForm'
import { RentSlotRow } from '../components/RentSlotRow'
import { InitWeekModal } from '../components/InitWeekModal'
import type { RentSlotUtxo, ListHeadUtxo } from '../hooks/useRentSlots'
import type { MutableOwnerFields } from '../components/OwnerInfoForm'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

interface WeekView {
  head: ListHeadUtxo
  weekEnd: number
  slots: RentSlotUtxo[]
}

function WeekCard({
  week,
  onCollect,
  collecting,
  onDeinit,
  deiniting,
}: {
  week: WeekView
  onCollect: (slot: RentSlotUtxo) => void
  collecting: boolean
  onDeinit: (head: ListHeadUtxo) => void
  deiniting: boolean
}) {
  const [open, setOpen] = React.useState(true)
  const { config } = week.head.datum
  const weekStartDate = new Date(config.weekStartPosix)
  const weekEndDate = new Date(week.weekEnd)
  const completedInWeek = week.slots.filter(s => s.datum.status === 'Completed')

  const fmt = (d: Date) =>
    d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="rounded-[12px] border border-[var(--line-strong)] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[var(--paper-2)] hover:bg-[var(--paper-3,var(--paper-2))] text-left"
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-[14px] font-semibold">
            {fmt(weekStartDate)} → {fmt(weekEndDate)}
          </span>
          <span className="text-[12px] text-[var(--muted)]">
            {config.openSlotIds.length} slots · {formatAda(config.rentPrice)} c/u
            {completedInWeek.length > 0 && (
              <span className="ml-2 text-[var(--mint-ink)] font-medium">
                · {completedInWeek.length} completado{completedInWeek.length > 1 ? 's' : ''}
              </span>
            )}
          </span>
        </div>
        <svg
          width="16" height="16" viewBox="0 0 16 16" fill="none"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="px-3 py-2 flex flex-col gap-1.5 border-t border-[var(--line-strong)]">
          {week.slots.length === 0 && (
            <p className="text-[var(--muted)] text-sm py-2 px-1">
              No se encontraron slots para esta semana en el contrato.
            </p>
          )}
          {week.slots.map(s => (
            <div key={s.txHash + '#' + s.outputIndex}>
              <RentSlotRow datum={s.datum} />
              {s.datum.status === 'Completed' && (
                <button
                  type="button"
                  disabled={collecting}
                  onClick={() => onCollect(s)}
                  className="mt-1 px-3 py-1.5 rounded-[8px] text-xs font-semibold border border-[var(--mint-ink)] text-[var(--mint-ink)] bg-[var(--mint-bg)] hover:opacity-80 disabled:opacity-40"
                >
                  {collecting ? 'Cobrando…' : 'Cobrar slot'}
                </button>
              )}
            </div>
          ))}
          {week.head.datum.next.tag === 'Empty' && (
            <div className="mt-1 pt-2 border-t border-[var(--line)]">
              <button
                type="button"
                disabled={deiniting}
                onClick={() => onDeinit(week.head)}
                className="px-3 py-1.5 rounded-[8px] text-xs font-semibold border border-[var(--line-strong)] text-[var(--muted)] hover:border-[var(--rose-ink)] hover:text-[var(--rose-ink)] disabled:opacity-40"
              >
                {deiniting ? 'Cerrando…' : 'Cerrar semana'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function OwnerPanel() {
  const { connected, pkh: ownerPkh } = useLucid()

  const { fields: ownerFields, loading: loadingFields, reload: reloadFields } = useOwnerFields(ownerPkh || null)
  const [selectedIdx, setSelectedIdx] = React.useState(0)
  const selectedField = ownerFields[selectedIdx] ?? null

  const { slots, heads, loading: loadingSlots, reload: reloadSlots } = useRentSlots(undefined, ownerPkh ?? undefined)

  const reload = React.useCallback(() => {
    reloadFields()
    reloadSlots()
  }, [reloadFields, reloadSlots])

  const [initWeekOpen, setInitWeekOpen] = React.useState(false)
  const [editInfoOpen, setEditInfoOpen] = React.useState(false)

  const { collectSlot, loading: collecting, error: collectError } = useCollectSlot()
  const [collectTxHash, setCollectTxHash] = React.useState<string | null>(null)

  const { deinitWeek, loading: deiniting, error: deinitError } = useDeinitWeek()
  const [deinitTxHash, setDeinitTxHash] = React.useState<string | null>(null)

  const { updateOwnerInfo, loading: updatingInfo, error: updateInfoError } = useUpdateOwnerInfo()
  const [updateTxHash, setUpdateTxHash] = React.useState<string | null>(null)

  if (!connected) return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center">
      <p className="text-[var(--muted)]">Conecta tu wallet para ver tu panel de propietario.</p>
    </div>
  )

  if (loadingFields) return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center">
      <p className="text-[var(--muted)]">Buscando tus canchas…</p>
    </div>
  )

  if (!selectedField) return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center">
      <p className="text-[var(--muted)] mb-4">No se encontró un Owner NFT para esta wallet.</p>
      <a href="/register" className="inline-block px-4 py-2 rounded-[10px] bg-[var(--accent)] text-white font-semibold text-sm">
        Registrarse como propietario
      </a>
    </div>
  )

  const record = selectedField.record
  const completedSlots = slots.filter(s => s.datum.status === 'Completed' && s.datum.fieldName === record.fieldName)

  // A head belongs to this field if:
  // (a) its ownerNFTName matches exactly — covers heads created after a rename, OR
  // (b) ownerPkh matches AND fieldName matches — covers heads created with a
  //     different registration's ownerNFTName but the same field name.
  const fieldHeads = heads.filter(h =>
    h.datum.ownerNFTName === selectedField.ownerNFTName ||
    (h.datum.ownerPkh === record.ownerPkh && h.datum.fieldName === record.fieldName)
  )

  const weeks: WeekView[] = fieldHeads
    .map(h => {
      const weekEnd = h.datum.config.weekStartPosix + WEEK_MS
      return { head: h, weekEnd, slots: slots.filter(s => s.datum.weekEnd === weekEnd && s.datum.fieldName === h.datum.fieldName) }
    })
    .sort((a, b) => a.head.datum.config.weekStartPosix - b.head.datum.config.weekStartPosix)

  const orphanSlots = slots.filter(s =>
    s.datum.fieldName === record.fieldName &&
    !fieldHeads.some(h => h.datum.config.weekStartPosix + WEEK_MS === s.datum.weekEnd)
  )

  const handleCollect = async (slot: RentSlotUtxo) => {
    try {
      const txHash = await collectSlot(slot)
      setCollectTxHash(txHash)
      setTimeout(() => reload(), 3_000)
    } catch { /* error shown in collectError */ }
  }

  // Cobrar el primer slot completado disponible (un clic = un slot).
  // Cada tx actualiza el Owner NFT UTxO, así que Blockfrost necesita ~20-40s
  // antes de que el siguiente clic funcione.
  const handleCollectNext = () => {
    const next = completedSlots[0]
    if (next) handleCollect(next)
  }

  const handleDeinit = async (head: ListHeadUtxo) => {
    try {
      const txHash = await deinitWeek(head)
      setDeinitTxHash(txHash)
      setTimeout(() => reload(), 3_000)
    } catch { /* error shown in deinitError */ }
  }

  const handleUpdateInfo = async (patch: MutableOwnerFields) => {
    if (!selectedField) return
    try {
      const txHash = await updateOwnerInfo(patch, selectedField.ownerNFTName)
      setUpdateTxHash(txHash)
      setEditInfoOpen(false)
      setTimeout(() => reload(), 3_000)
    } catch { /* error shown in updateInfoError */ }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6">
      <div className="flex gap-2 flex-wrap items-center">
        {ownerFields.map((f, i) => (
          <button
            key={f.ownerNFTName}
            type="button"
            onClick={() => { setSelectedIdx(i); setEditInfoOpen(false) }}
            className={[
              'px-3.5 py-2 rounded-[10px] text-[13px] font-semibold border',
              i === selectedIdx
                ? 'bg-[var(--ink)] text-[var(--paper)] border-[var(--ink)]'
                : 'bg-[var(--paper)] text-[var(--ink)] border-[var(--line-strong)] hover:border-[var(--ink)]',
            ].join(' ')}
          >
            {decodeBBS(f.record.fieldName) || `Cancha ${i + 1}`}
          </button>
        ))}
        <a
          href="/register"
          className="px-3.5 py-2 rounded-[10px] text-[13px] font-semibold border border-dashed border-[var(--line-strong)] text-[var(--muted)] hover:border-[var(--ink)] hover:text-[var(--ink)] inline-flex items-center gap-1.5"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Registrar cancha
        </a>
      </div>

      <OwnerRecordCard
        record={record}
        viewerPkh={ownerPkh ?? undefined}
        onUpdateInfo={() => setEditInfoOpen(v => !v)}
        onCollectPayments={handleCollectNext}
        completedCount={completedSlots.length}
        collecting={collecting}
      />

      {editInfoOpen && (
        <OwnerInfoForm
          record={record}
          onSubmit={handleUpdateInfo}
          submitting={updatingInfo}
        />
      )}

      {updateInfoError && (
        <div className="px-4 py-3 rounded-[10px] bg-[var(--rose-bg)] border border-[#ecb5ac] text-[var(--rose-ink)] text-sm">
          Error al actualizar: {updateInfoError}
        </div>
      )}
      {updateTxHash && (
        <div className="px-4 py-3 rounded-[10px] bg-[var(--mint-bg)] border border-[#b9d8c1] text-[#244d33] text-sm flex items-center justify-between">
          <span>¡Info actualizada! Tx: <span className="font-mono">{updateTxHash.slice(0, 12)}…</span></span>
          <button onClick={() => setUpdateTxHash(null)} className="text-[var(--muted)] hover:text-[var(--ink)] ml-2">✕</button>
        </div>
      )}

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

      {deinitError && (
        <div className="px-4 py-3 rounded-[10px] bg-[var(--rose-bg)] border border-[#ecb5ac] text-[var(--rose-ink)] text-sm">
          Error al cerrar semana: {deinitError}
        </div>
      )}
      {deinitTxHash && (
        <div className="px-4 py-3 rounded-[10px] bg-[var(--mint-bg)] border border-[#b9d8c1] text-[#244d33] text-sm flex items-center justify-between">
          <span>¡Semana cerrada! Tx: <span className="font-mono">{deinitTxHash.slice(0, 12)}…</span></span>
          <button onClick={() => setDeinitTxHash(null)} className="text-[var(--muted)] hover:text-[var(--ink)] ml-2">✕</button>
        </div>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[18px] font-semibold">Semanas programadas</h2>
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
        {loadingSlots && <p className="text-[var(--muted)] text-sm">Cargando…</p>}
        {!loadingSlots && fieldHeads.length === 0 && (
          <p className="text-[var(--muted)] text-sm">No hay semanas programadas para esta cancha.</p>
        )}
        <div className="flex flex-col gap-3">
          {weeks.map(w => (
            <WeekCard
              key={w.head.txHash + '#' + w.head.outputIndex}
              week={w}
              onCollect={handleCollect}
              collecting={collecting}
              onDeinit={handleDeinit}
              deiniting={deiniting}
            />
          ))}
          {orphanSlots.length > 0 && (
            <div className="rounded-[12px] border border-dashed border-[var(--line-strong)] px-3 py-2 flex flex-col gap-1.5">
              <p className="text-[12px] text-[var(--muted)] font-medium mb-1">Slots sin semana asociada</p>
              {orphanSlots.map(s => (
                <div key={s.txHash + '#' + s.outputIndex}>
                  <RentSlotRow datum={s.datum} />
                  {s.datum.status === 'Completed' && (
                    <button
                      type="button"
                      disabled={collecting}
                      onClick={() => handleCollect(s)}
                      className="mt-1 px-3 py-1.5 rounded-[8px] text-xs font-semibold border border-[var(--mint-ink)] text-[var(--mint-ink)] bg-[var(--mint-bg)] hover:opacity-80 disabled:opacity-40"
                    >
                      {collecting ? 'Cobrando…' : 'Cobrar slot'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {record && (
        <InitWeekModal
          record={record}
          existingHeads={fieldHeads}
          open={initWeekOpen}
          onClose={() => setInitWeekOpen(false)}
          onDone={() => setInitWeekOpen(false)}
        />
      )}
    </div>
  )
}
