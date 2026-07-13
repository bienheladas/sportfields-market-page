import * as React from 'react'
import { useLucid } from '../lib/LucidContext'
import { useOwnerFields } from '../hooks/useOwnerFields'
import { useRentSlots } from '../hooks/useRentSlots'
import { useCollectSlot } from '../hooks/useCollectSlot'
import { useCollectWeek } from '../hooks/useCollectWeek'
import { useForceClosePending } from '../hooks/useForceClosePending'
import { useDeinitWeek } from '../hooks/useDeinitWeek'
import { useUpdateOwnerInfo } from '../hooks/useUpdateOwnerInfo'
import { useDeregisterOwner } from '../hooks/useDeregisterOwner'
import { useStrandedOwnerFields, useRecoverOldField, type StrandedField } from '../hooks/useRecoverOldField'
import { OwnerRecordCard } from '../components/OwnerRecordCard'
import { decodeBBS, formatAda } from '../components/lib'
import { OwnerInfoForm } from '../components/OwnerInfoForm'
import { RentSlotRow } from '../components/RentSlotRow'
import { InitWeekModal } from '../components/InitWeekModal'
import type { RentSlotUtxo, ListHeadUtxo } from '../hooks/useRentSlots'
import type { MutableOwnerFields } from '../components/OwnerInfoForm'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function RecoveryCard({ field }: { field: StrandedField }) {
  const { deinitOldWeek, deregisterOldField, loading: recovering, error: recoveryError } = useRecoverOldField()
  const [step, setStep] = React.useState<'deinit' | 'deregister' | 'done'>(() =>
    field.activeWeeksCount === 0n ? 'deregister' : 'deinit'
  )
  const [txHash, setTxHash] = React.useState<string | null>(null)
  const [localError, setLocalError] = React.useState<string | null>(null)

  const now = Date.now()
  const weekEndMs = field.weekEnd ? Number(field.weekEnd) : 0
  const canDeinit = !field.weekEnd || now > weekEndMs
  const unlockDate = weekEndMs ? new Date(weekEndMs).toLocaleDateString('es-PE', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima',
  }) : null

  const totalLocked = [...field.lockedWeeks.values()].reduce((a, b) => a + b, 0n)

  const handleDeinit = async () => {
    setLocalError(null)
    try {
      const hash = await deinitOldWeek(field)
      setTxHash(hash)
      setStep('deregister')
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleDeregister = async () => {
    setLocalError(null)
    try {
      const hash = await deregisterOldField({ ...field, activeWeeksCount: 0n, weekEnd: null })
      setTxHash(hash)
      setStep('done')
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="rounded-[12px] border border-amber-300 bg-amber-50 p-4 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <span className="text-amber-600 text-[16px] leading-none mt-0.5">⚠</span>
        <div className="flex-1 min-w-0">
          <p className="m-0 text-[14px] font-semibold text-amber-900">
            Cancha en dirección antigua: {decodeBBS(field.fieldName)}
          </p>
          <p className="m-0 mt-0.5 text-[12px] text-amber-700 leading-snug">
            Fondos bloqueados: <strong>{formatAda(field.lovelace)}</strong>
            {totalLocked > 0n && <span> (garantía: {formatAda(totalLocked)})</span>}
            . Recuperalos en 2 pasos.
          </p>
        </div>
      </div>

      {step === 'done' ? (
        <div className="px-3 py-2 rounded-[8px] bg-green-50 border border-green-300 text-[13px] text-green-800">
          ✓ Recuperación completada. Ya podés re-registrar la cancha.
          {txHash && <code className="block mt-1 text-[11px] break-all">{txHash}</code>}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <StepRow
              n={1}
              label="Cerrar semana (libera garantía)"
              active={step === 'deinit'}
              done={step === 'deregister'}
            >
              {step === 'deinit' && (
                canDeinit ? (
                  <button
                    type="button"
                    disabled={recovering}
                    onClick={handleDeinit}
                    className="px-3 py-1.5 rounded-[8px] text-[12px] font-semibold bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-40"
                  >
                    {recovering ? 'Firmando…' : 'Cerrar semana'}
                  </button>
                ) : (
                  <p className="text-[11px] text-amber-700 italic">
                    Disponible desde: {unlockDate}
                  </p>
                )
              )}
              {step === 'deregister' && txHash && (
                <code className="text-[11px] text-amber-700 break-all">Tx: {txHash.slice(0, 16)}…</code>
              )}
            </StepRow>

            <StepRow
              n={2}
              label="Dar de baja la cancha (quema el NFT)"
              active={step === 'deregister'}
              done={false}
            >
              {step === 'deregister' && (
                <button
                  type="button"
                  disabled={recovering}
                  onClick={handleDeregister}
                  className="px-3 py-1.5 rounded-[8px] text-[12px] font-semibold bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-40"
                >
                  {recovering ? 'Firmando…' : 'Dar de baja'}
                </button>
              )}
            </StepRow>
          </div>

          <p className="m-0 text-[11px] text-amber-700">
            Después del paso 2, re-registrá la cancha en "Registrar cancha" para volver a usarla.
          </p>
        </>
      )}

      {(localError || recoveryError) && (
        <div className="px-3 py-2 rounded-[8px] bg-red-50 border border-red-300 text-[12px] text-red-800 break-words">
          {localError || recoveryError}
        </div>
      )}
    </div>
  )
}

function StepRow({ n, label, active, done, children }: {
  n: number; label: string; active: boolean; done: boolean; children?: React.ReactNode
}) {
  return (
    <div className={`flex items-start gap-2.5 px-3 py-2 rounded-[8px] ${active ? 'bg-white border border-amber-300' : 'opacity-60'}`}>
      <span className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold mt-0.5
        ${done ? 'bg-green-500 text-white' : active ? 'bg-amber-600 text-white' : 'bg-amber-200 text-amber-700'}`}>
        {done ? '✓' : n}
      </span>
      <div className="flex-1 min-w-0">
        <p className="m-0 text-[12px] font-medium text-amber-900">{label}</p>
        {children}
      </div>
    </div>
  )
}

interface WeekView {
  head: ListHeadUtxo
  weekEnd: number
  slots: RentSlotUtxo[]
}

function WeekCard({
  week,
  now,
  onCollectWeek,
  collectingWeek,
  onDeinit,
  deiniting,
  timeZone,
}: {
  week: WeekView
  now: number
  onCollectWeek: (head: ListHeadUtxo) => void
  collectingWeek: boolean
  onDeinit: (head: ListHeadUtxo) => void
  deiniting: boolean
  /** Field's IANA timezone (OwnerRecord.timezone) — defaults to UTC if unknown. */
  timeZone?: string
}) {
  const [open, setOpen] = React.useState(true)
  const { config } = week.head.datum
  const weekStartDate = new Date(config.weekStartPosix)
  const weekEndDate = new Date(week.weekEnd)
  const completedInWeek = week.slots.filter(s => s.datum.status === 'Completed')

  // Cobrables tras week_end: Completed + Confirmed no-shows + Pendings sin
  // confirmar. El collect semanal los cobra todos en una tx (los no-shows queman
  // su Rent NFT; los Pendings entregan al owner su depósito del 50%).
  const weekOver = now > week.weekEnd
  const collectableSlots = weekOver
    ? week.slots.filter(s =>
        s.datum.status === 'Completed' || s.datum.status === 'Confirmed' || s.datum.status === 'Pending')
    : []
  const collectableTotal = collectableSlots.reduce(
    (sum, s) => sum + (s.datum.status === 'Pending' ? s.datum.rentPrice / 2n : s.datum.rentPrice),
    0n,
  )
  const noShowCount = collectableSlots.filter(s => s.datum.status === 'Confirmed').length
  const pendingCount = collectableSlots.filter(s => s.datum.status === 'Pending').length

  // weekStartPosix/weekEnd are UTC on-chain — format in the field's own
  // timezone, matching the schedule's local hours (see lib/timezone.ts).
  const tz = timeZone || 'UTC'
  const fmt = (d: Date) =>
    d.toLocaleDateString('es-AR', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' })

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
          {collectableSlots.length > 0 && (
            <div className="my-1 p-3 rounded-[10px] bg-[var(--mint-bg)] border border-[#b9d8c1] flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[13px] text-[#244d33]">
                <span className="font-semibold">Semana terminada</span> — {collectableSlots.length} slot{collectableSlots.length > 1 ? 's' : ''} por
                cobrar ({formatAda(collectableTotal)})
                {noShowCount > 0 && <span className="text-[12px]"> · incluye {noShowCount} no-show{noShowCount > 1 ? 's' : ''}</span>}
                {pendingCount > 0 && <span className="text-[12px]"> · {pendingCount} sin confirmar (depósito 50%)</span>}
              </div>
              <button
                type="button"
                disabled={collectingWeek}
                onClick={() => onCollectWeek(week.head)}
                className="px-4 py-2 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-deep)] text-white font-semibold text-[13px] disabled:opacity-50"
              >
                {collectingWeek ? 'Cobrando…' : `Cobrar alquileres de la semana (${formatAda(collectableTotal)})`}
              </button>
            </div>
          )}
          {week.slots.length === 0 && (
            <p className="text-[var(--muted)] text-sm py-2 px-1">
              No se encontraron slots para esta semana en el contrato.
            </p>
          )}
          {week.slots.map(s => (
            <RentSlotRow key={s.txHash + '#' + s.outputIndex} datum={s.datum} timeZone={tz} />
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

  const { strandedFields, loadingStranded } = useStrandedOwnerFields(ownerPkh || null)

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

  const { collectWeek, loading: collectingWeek, error: collectWeekError } = useCollectWeek()

  const { forceClosePending, loading: forceClosing, error: forceCloseError } = useForceClosePending()
  const [forceCloseTxHash, setForceCloseTxHash] = React.useState<string | null>(null)

  const { deinitWeek, loading: deiniting, error: deinitError } = useDeinitWeek()
  const [deinitTxHash, setDeinitTxHash] = React.useState<string | null>(null)

  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const { updateOwnerInfo, loading: updatingInfo, error: updateInfoError } = useUpdateOwnerInfo()
  const [updateTxHash, setUpdateTxHash] = React.useState<string | null>(null)

  const { deregister, loading: deregistering, error: deregisterError } = useDeregisterOwner()
  const [deregisterTxHash, setDeregisterTxHash] = React.useState<string | null>(null)

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
    <div className="max-w-xl mx-auto px-4 py-8 flex flex-col gap-6">
      {strandedFields.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-[16px] font-semibold text-amber-800">Canchas en dirección anterior</h2>
          {strandedFields.map(f => (
            <RecoveryCard key={f.ownerNFTName} field={f} />
          ))}
        </div>
      )}
      {!loadingStranded && strandedFields.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-[var(--muted)] mb-4">No se encontró un Owner NFT para esta wallet.</p>
          <a href="/register" className="inline-block px-4 py-2 rounded-[10px] bg-[var(--accent)] text-white font-semibold text-sm">
            Registrarse como propietario
          </a>
        </div>
      )}
    </div>
  )

  const record = selectedField.record

  const fieldHeads = heads.filter(h => h.datum.ownerNFTName === selectedField.ownerNFTName)

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

  // Cobro por slot: solo queda como fallback para slots huérfanos (sin head —
  // el cobro semanal necesita la linked list de la semana).
  const handleCollect = async (slot: RentSlotUtxo) => {
    try {
      const txHash = await collectSlot(slot)
      setCollectTxHash(txHash)
      setTimeout(() => reload(), 3_000)
    } catch { /* error shown in collectError */ }
  }

  const handleCollectWeek = async (head: ListHeadUtxo) => {
    try {
      const txHash = await collectWeek(head)
      setCollectTxHash(txHash)
      setTimeout(() => reload(), 3_000)
    } catch { /* error shown in collectWeekError */ }
  }

  const handleForceClose = async (slot: RentSlotUtxo) => {
    try {
      const txHash = await forceClosePending(slot)
      setForceCloseTxHash(txHash)
      setTimeout(() => reload(), 3_000)
    } catch { /* error shown in forceCloseError */ }
  }

  const handleDeinit = async (head: ListHeadUtxo) => {
    try {
      const txHash = await deinitWeek(head)
      setDeinitTxHash(txHash)
      setTimeout(() => reload(), 3_000)
    } catch { /* error shown in deinitError */ }
  }

  const handleDeregister = async () => {
    if (!selectedField) return
    try {
      const txHash = await deregister(selectedField.ownerNFTName)
      setDeregisterTxHash(txHash)
      setTimeout(() => reload(), 3_000)
    } catch { /* error shown in deregisterError */ }
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
      {strandedFields.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-[16px] font-semibold text-amber-800">Canchas en dirección anterior (necesitan recuperación)</h2>
          {strandedFields.map(f => (
            <RecoveryCard key={f.ownerNFTName} field={f} />
          ))}
        </div>
      )}
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
      {collectWeekError && (
        <div className="px-4 py-3 rounded-[10px] bg-[var(--rose-bg)] border border-[#ecb5ac] text-[var(--rose-ink)] text-sm">
          Error al cobrar la semana: {collectWeekError}
        </div>
      )}
      {collectTxHash && (
        <div className="px-4 py-3 rounded-[10px] bg-[var(--mint-bg)] border border-[#b9d8c1] text-[#244d33] text-sm flex items-center justify-between">
          <span>¡Cobro exitoso! Tx: <span className="font-mono">{collectTxHash.slice(0, 12)}…</span></span>
          <button onClick={() => setCollectTxHash(null)} className="text-[var(--muted)] hover:text-[var(--ink)] ml-2">✕</button>
        </div>
      )}

      {forceCloseError && (
        <div className="px-4 py-3 rounded-[10px] bg-[var(--rose-bg)] border border-[#ecb5ac] text-[var(--rose-ink)] text-sm">
          Error al forzar cierre: {forceCloseError}
        </div>
      )}
      {forceCloseTxHash && (
        <div className="px-4 py-3 rounded-[10px] bg-[var(--mint-bg)] border border-[#b9d8c1] text-[#244d33] text-sm flex items-center justify-between">
          <span>¡Slot cerrado! Tx: <span className="font-mono">{forceCloseTxHash.slice(0, 12)}…</span></span>
          <button onClick={() => setForceCloseTxHash(null)} className="text-[var(--muted)] hover:text-[var(--ink)] ml-2">✕</button>
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
              now={now}
              onCollectWeek={handleCollectWeek}
              collectingWeek={collectingWeek}
              onDeinit={handleDeinit}
              deiniting={deiniting}
              timeZone={record.timezone}
            />
          ))}
          {orphanSlots.length > 0 && (
            <div className="rounded-[12px] border border-dashed border-[var(--line-strong)] px-3 py-2 flex flex-col gap-1.5">
              <p className="text-[12px] text-[var(--muted)] font-medium mb-1">Slots sin semana asociada</p>
              {orphanSlots.map(s => (
                <div key={s.txHash + '#' + s.outputIndex}>
                  <RentSlotRow datum={s.datum} timeZone={record.timezone} />
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
                  {s.datum.status === 'Pending' && now > s.datum.cancelDeadline && (
                    <button
                      type="button"
                      disabled={forceClosing}
                      onClick={() => handleForceClose(s)}
                      className="mt-1 px-3 py-1.5 rounded-[8px] text-xs font-semibold border border-[var(--rose-ink)] text-[var(--rose-ink)] bg-[var(--rose-bg)] hover:opacity-80 disabled:opacity-40"
                    >
                      {forceClosing ? 'Cerrando…' : 'Forzar cierre (cliente no confirmó)'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-[18px] font-semibold mb-2">Dar de baja esta cancha</h2>
        <p className="text-[var(--muted)] text-sm mb-3">
          Quema tu Owner NFT y libera el stats UTxO. Requiere que no haya semana activa
          (cerrá la semana primero). Solo necesita tu firma.
        </p>
        {record.activeWeeksCount !== 0 ? (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-[10px] px-3 py-2">
            Hay {record.activeWeeksCount} semana(s) activa(s) — cerralas (Cerrar semana) antes de poder dar de baja.
          </p>
        ) : (
          <>
            {deregisterError && (
              <div className="px-4 py-3 mb-3 rounded-[10px] bg-[var(--rose-bg)] border border-[#ecb5ac] text-[var(--rose-ink)] text-sm">
                {deregisterError}
              </div>
            )}
            {deregisterTxHash ? (
              <div className="px-4 py-3 rounded-[10px] bg-[var(--mint-bg)] border border-[#b9d8c1] text-[#244d33] text-sm">
                ¡Cancha dada de baja! Tx: <span className="font-mono">{deregisterTxHash.slice(0, 12)}…</span>
              </div>
            ) : (
              <button
                type="button"
                disabled={deregistering}
                onClick={handleDeregister}
                className="px-3.5 py-2 rounded-[10px] border border-[var(--rose-ink)] text-[var(--rose-ink)] bg-[var(--rose-bg)] text-[13px] font-semibold disabled:opacity-40"
              >
                {deregistering ? 'Firmando…' : 'Dar de baja'}
              </button>
            )}
          </>
        )}
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
