import * as React from 'react'
import type { OwnerRecord } from './types'
import type { ListHeadUtxo } from '../hooks/useRentSlots'
import { useInitWeek, type DaySchedule, type InitWeekParams } from '../hooks/useInitWeek'
import { useCompanyConfig } from '../hooks/useCompanyConfig'
import { decodeBBS } from './lib'

// ── Helpers ────────────────────────────────────────────────────────

const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

const DEFAULT_SCHEDULE: DaySchedule[] = [
  { enabled: true,  open: 11, close: 23 }, // Lun
  { enabled: true,  open: 11, close: 23 }, // Mar
  { enabled: true,  open: 11, close: 23 }, // Mié
  { enabled: true,  open: 11, close: 23 }, // Jue
  { enabled: true,  open: 11, close: 23 }, // Vie
  { enabled: true,  open:  7, close: 24 }, // Sáb
  { enabled: true,  open:  7, close: 24 }, // Dom
]

function nextMonday(): string {
  const now = new Date()
  const d   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dow = d.getUTCDay()
  const add = dow === 1 ? 0 : dow === 0 ? 1 : 8 - dow
  d.setUTCDate(d.getUTCDate() + add)
  return d.toISOString().slice(0, 10)
}

function getISOWeekLabel(posixMs: number): string {
  const d   = new Date(posixMs)
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7)
  return `Sem. ${week}/${tmp.getUTCFullYear()}`
}

function slotCount(s: DaySchedule[]): number {
  return s.reduce((n, d) => n + (d.enabled && d.close > d.open ? d.close - d.open : 0), 0)
}

const MIN_UTXO_PER_SLOT_ADA = 2.1

// Total ADA the owner needs to lock for the week: the fixed min-UTxO per slot
// (constant, regardless of price) PLUS the guarantee (guaranteeBps% of
// rent_price, per slot — see LockGuarantee in useInitWeek.ts). Previously this
// only counted the min-UTxO, so the preview showed nearly the same number for
// any rent_price — the guarantee itself was never included.
function totalAdaNeeded(slots: number, priceAda: number, guaranteeBps: number): number {
  const guaranteePerSlotAda = priceAda * guaranteeBps / 10000
  return slots * (MIN_UTXO_PER_SLOT_ADA + guaranteePerSlotAda)
}

// ── Props ──────────────────────────────────────────────────────────

export interface InitWeekModalProps {
  record: OwnerRecord
  existingHeads: ListHeadUtxo[]
  open: boolean
  onClose: () => void
  onDone: (txHashes: string[]) => void
}

// ── Modal ──────────────────────────────────────────────────────────

type Step = 'form' | 'confirm' | 'submitting' | 'done'

export function InitWeekModal({ record, existingHeads, open, onClose, onDone }: InitWeekModalProps) {
  const { initWeek, loading, error } = useInitWeek()
  const { config: companyConfig } = useCompanyConfig()
  const guaranteeBps = companyConfig?.guaranteeBps ?? 2000

  const [step, setStep]           = React.useState<Step>('form')
  const [weekDate, setWeekDate]   = React.useState(nextMonday)
  const [priceAda, setPriceAda]   = React.useState('10')
  const [cancelH, setCancelH]     = React.useState('24')
  const [schedule, setSchedule]   = React.useState<DaySchedule[]>(DEFAULT_SCHEDULE)
  const [dateErr, setDateErr]     = React.useState<string | null>(null)
  const [txHashes, setTxHashes]   = React.useState<string[]>([])

  if (!open) return null

  // ── Validation ─────────────────────────────────────────────────

  function validateDate(v: string): string | null {
    const d = new Date(v + 'T00:00:00Z')
    if (isNaN(d.getTime())) return 'Fecha inválida.'
    if (d.getUTCDay() !== 1) return 'Debe ser un lunes.'
    return null
  }

  const dateErrLive = validateDate(weekDate)
  const priceNum    = parseFloat(priceAda)
  const priceOk     = !isNaN(priceNum) && priceNum >= 0.5
  const cancelNum   = parseInt(cancelH, 10)
  const slots       = slotCount(schedule)
  const canConfirm  = !dateErrLive && priceOk && slots > 0

  // ── Handlers ───────────────────────────────────────────────────

  function handleContinue() {
    const e = validateDate(weekDate)
    setDateErr(e)
    if (e || !priceOk || slots === 0) return
    const weekStartMs = new Date(weekDate + 'T00:00:00Z').getTime()
    const duplicate = existingHeads.some(h => h.datum.config.weekStartPosix === weekStartMs)
    if (duplicate) {
      const label = getISOWeekLabel(weekStartMs)
      setDateErr(`Ya existe una semana programada para ${label}. Elegí otra fecha.`)
      return
    }
    setStep('confirm')
  }

  async function handleSubmit() {
    setStep('submitting')
    const params: InitWeekParams = {
      weekStart:            new Date(weekDate + 'T00:00:00Z'),
      rentPriceLovelace:    BigInt(Math.round(priceNum * 1_000_000)),
      cancelDeadlineHours:  cancelNum,
      schedule,
    }
    try {
      const hashes = await initWeek(record, params)
      setTxHashes(hashes)
      setStep('done')
      onDone(hashes)
    } catch {
      setStep('confirm')
    }
  }

  function handleClose() {
    if (loading) return
    setStep('form')
    onClose()
  }

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className="bg-[var(--paper)] border border-[var(--line)] rounded-2xl shadow-[0_8px_32px_rgba(20,16,8,.18)] w-full max-w-[620px] max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <header className="px-6 pt-5 pb-4 border-b border-[var(--line)] flex items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-[18px] font-semibold tracking-[-0.012em]">
              Programar semana
            </h2>
            <p className="m-0 mt-0.5 text-[13px] text-[var(--muted)]">
              {decodeBBS(record.fieldName)}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[var(--muted)] hover:bg-[var(--paper-2)] hover:text-[var(--ink)] disabled:opacity-40"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {step === 'form' && (
          <FormBody
            weekDate={weekDate} setWeekDate={(v) => { setWeekDate(v); setDateErr(null) }}
            dateErr={dateErr}
            priceAda={priceAda} setPriceAda={setPriceAda}
            cancelH={cancelH} setCancelH={setCancelH}
            schedule={schedule} setSchedule={setSchedule}
            slots={slots}
            totalAda={totalAdaNeeded(slots, priceOk ? priceNum : 0, guaranteeBps)}
            canConfirm={canConfirm}
            onContinue={handleContinue}
          />
        )}

        {step === 'confirm' && (
          <ConfirmBody
            weekDate={weekDate}
            isoWeekLabel={getISOWeekLabel(new Date(weekDate + 'T00:00:00Z').getTime())}
            priceAda={priceNum}
            cancelH={cancelNum}
            schedule={schedule}
            slots={slots}
            totalAda={totalAdaNeeded(slots, priceNum, guaranteeBps)}
            guaranteeBps={guaranteeBps}
            error={error}
            onBack={() => setStep('form')}
            onSubmit={handleSubmit}
          />
        )}

        {step === 'submitting' && (
          <SubmittingBody />
        )}

        {step === 'done' && (
          <DoneBody txHashes={txHashes} onClose={handleClose} />
        )}
      </div>
    </div>
  )
}

// ── Form step ──────────────────────────────────────────────────────

function FormBody({
  weekDate, setWeekDate, dateErr,
  priceAda, setPriceAda,
  cancelH, setCancelH,
  schedule, setSchedule,
  slots, totalAda, canConfirm, onContinue,
}: {
  weekDate: string; setWeekDate: (v: string) => void; dateErr: string | null
  priceAda: string; setPriceAda: (v: string) => void
  cancelH: string; setCancelH: (v: string) => void
  schedule: DaySchedule[]; setSchedule: (s: DaySchedule[]) => void
  slots: number; totalAda: number; canConfirm: boolean
  onContinue: () => void
}) {
  const updateDay = (i: number, patch: Partial<DaySchedule>) =>
    setSchedule(schedule.map((d, idx) => idx === i ? { ...d, ...patch } : d))

  return (
    <div className="px-6 py-5 flex flex-col gap-5">

      {/* Week + Price row */}
      <div className="grid grid-cols-2 gap-3.5 max-[480px]:grid-cols-1">
        <Field label="Semana (lunes)" error={dateErr}>
          <input
            type="date"
            value={weekDate}
            onChange={e => setWeekDate(e.target.value)}
            className={inputCls(!!dateErr)}
          />
          {!dateErr && weekDate && (() => {
            const ms = new Date(weekDate + 'T00:00:00Z').getTime()
            return !isNaN(ms)
              ? <span className="text-[11px] text-[var(--muted)] mt-0.5">{getISOWeekLabel(ms)}</span>
              : null
          })()}
        </Field>
        <Field label="Precio por slot (ADA)">
          <input
            type="number"
            min="0.5"
            step="0.5"
            value={priceAda}
            onChange={e => setPriceAda(e.target.value)}
            className={inputCls(false)}
          />
        </Field>
      </div>

      {/* Cancel deadline */}
      <Field label="Cancelación hasta (horas antes)">
        <select
          value={cancelH}
          onChange={e => setCancelH(e.target.value)}
          className={inputCls(false)}
        >
          {[1, 2, 6, 12, 24, 48].map(h => (
            <option key={h} value={String(h)}>{h}h antes del inicio</option>
          ))}
        </select>
      </Field>

      {/* Schedule */}
      <div>
        <div className="text-[11px] uppercase tracking-[0.06em] text-[var(--muted)] font-bold mb-2">
          Horario
        </div>
        <div className="border border-[var(--line)] rounded-[10px] overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-[var(--paper-2)] border-b border-[var(--line)]">
                <th className="px-3 py-2 text-left font-semibold text-[11px] uppercase tracking-[0.05em] text-[var(--muted)] w-12">Día</th>
                <th className="px-3 py-2 text-left font-semibold text-[11px] uppercase tracking-[0.05em] text-[var(--muted)]">Apertura</th>
                <th className="px-3 py-2 text-left font-semibold text-[11px] uppercase tracking-[0.05em] text-[var(--muted)]">Cierre</th>
                <th className="px-3 py-2 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[var(--muted)]">Slots</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((d, i) => (
                <tr key={i} className={['border-b border-[var(--line)] last:border-b-0', !d.enabled ? 'opacity-50' : ''].join(' ')}>
                  <td className="px-3 py-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={d.enabled}
                        onChange={e => updateDay(i, { enabled: e.target.checked })}
                        className="w-3.5 h-3.5 accent-[var(--accent)]"
                      />
                      <span className="font-semibold text-[var(--ink)]">{DAY_LABELS[i]}</span>
                    </label>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      disabled={!d.enabled}
                      value={d.open}
                      onChange={e => updateDay(i, { open: Number(e.target.value) })}
                      className="bg-[var(--paper)] border border-[var(--line-strong)] rounded-lg px-2 py-1 text-[13px] w-20 disabled:opacity-50"
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>{String(h).padStart(2,'0')}:00</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      disabled={!d.enabled}
                      value={d.close}
                      onChange={e => updateDay(i, { close: Number(e.target.value) })}
                      className="bg-[var(--paper)] border border-[var(--line-strong)] rounded-lg px-2 py-1 text-[13px] w-20 disabled:opacity-50"
                    >
                      {Array.from({ length: 24 }, (_, h) => h + 1).map(h => (
                        <option key={h} value={h}>{String(h).padStart(2,'0')}:00</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--muted)]">
                    {d.enabled && d.close > d.open ? d.close - d.open : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between text-[13px] bg-[var(--paper-2)] border border-[var(--line)] rounded-[10px] px-4 py-3">
        <span className="text-[var(--muted)]">
          <strong className="text-[var(--ink)]">{slots}</strong> slots · {Math.ceil(slots / 24)} tx
        </span>
        <span className="font-mono font-semibold">
          ~{totalAda.toFixed(1)} ₳ bloqueados
        </span>
      </div>

      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={onContinue}
          disabled={!canConfirm}
          className={['px-[18px] py-3 rounded-[10px] font-semibold text-[14px] inline-flex items-center gap-2',
            canConfirm ? 'bg-[var(--accent)] hover:bg-[var(--accent-deep)] text-white' : 'bg-[var(--paper-3)] text-[var(--muted)] cursor-not-allowed',
          ].join(' ')}
        >
          Revisar
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ── Confirm step ───────────────────────────────────────────────────

function ConfirmBody({
  weekDate, isoWeekLabel, priceAda, cancelH, schedule, slots, totalAda, guaranteeBps, error, onBack, onSubmit,
}: {
  weekDate: string; isoWeekLabel: string; priceAda: number; cancelH: number
  schedule: DaySchedule[]; slots: number; totalAda: number; guaranteeBps: number
  error: string | null; onBack: () => void; onSubmit: () => void
}) {
  return (
    <div className="px-6 py-5 flex flex-col gap-4">
      <div className="bg-[var(--paper-2)] border border-[var(--line)] rounded-[10px] overflow-hidden">
        <table className="w-full text-[13px]">
          <tbody>
            <SummaryRow k="Semana" v={`${weekDate} · ${isoWeekLabel}`} />
            <SummaryRow k="Precio/slot" v={`${priceAda} ₳`} mono />
            <SummaryRow k="Cancelación" v={`hasta ${cancelH}h antes`} />
            <SummaryRow k="Comisión plataforma" v="1%" />
            <SummaryRow k="Slots" v={String(slots)} mono />
            <SummaryRow k="ADA bloqueado" v={`~${totalAda.toFixed(1)} ₳`} mono />
          </tbody>
        </table>
      </div>

      <div className="text-[12px] text-[var(--muted)] bg-[var(--paper-2)] border border-[var(--line)] rounded-[10px] px-4 py-3">
        Por slot: 2.1 ₳ de min-UTxO (quedan bloqueados en RentValidator, se recuperan al expirar o liquidar el slot) + {(priceAda * guaranteeBps / 10000).toFixed(2)} ₳ de garantía
        ({(guaranteeBps / 100).toFixed(0)}% del precio, se libera al cobrar cada turno).
      </div>

      {error && (
        <div className="flex items-start gap-2.5 p-3 px-3.5 rounded-[10px] bg-[var(--rose-bg)] border border-[#ecb5ac] text-[var(--rose-ink,#6f2920)] text-[13px]">
          <svg className="shrink-0 mt-px" width="15" height="15" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <span className="font-mono text-[11px] break-all">{error}</span>
        </div>
      )}

      <div className="flex gap-2.5 justify-end">
        <button type="button" onClick={onBack}
          className="px-[18px] py-3 rounded-[10px] border border-[var(--line-strong)] text-[var(--ink)] font-semibold text-[14px]">
          ← Editar
        </button>
        <button type="button" onClick={onSubmit}
          className="px-[18px] py-3 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-deep)] text-white font-semibold text-[14px]">
          {error ? 'Reintentar' : 'Confirmar'}
        </button>
      </div>
    </div>
  )
}

// ── Submitting step ────────────────────────────────────────────────

function SubmittingBody() {
  return (
    <div className="px-6 py-8 flex flex-col items-center gap-5">
      <Spinner />
      <div className="text-center">
        <p className="font-semibold text-[15px]">Creando semana…</p>
        <p className="text-[13px] text-[var(--muted)] mt-1">Firmá la transacción en tu wallet…</p>
      </div>
    </div>
  )
}

// ── Done step ──────────────────────────────────────────────────────

function DoneBody({ txHashes, onClose }: { txHashes: string[]; onClose: () => void }) {
  return (
    <div className="px-6 py-8 flex flex-col items-center gap-5">
      <div className="w-[64px] h-[64px] rounded-full bg-[var(--mint-bg)] grid place-items-center text-[var(--mint-deep,#4d9669)]">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.6" />
          <path d="M10 16l4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="text-center">
        <h3 className="font-bold text-[20px] m-0 mb-1">¡Semana programada!</h3>
        <p className="text-[13px] text-[var(--muted)] m-0">
          Transacción confirmada.
        </p>
      </div>
      <div className="w-full flex flex-col gap-1.5">
        {txHashes.map((h) => (
          <div key={h} className="bg-[var(--paper-2)] border border-[var(--line)] rounded-[10px] px-4 py-2.5 flex items-center justify-between gap-3">
            <span className="text-[12px] font-mono text-[var(--ink)] truncate">{h}</span>
            <a
              href={`https://preview.cardanoscan.io/transaction/${h}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-semibold text-[var(--accent)] whitespace-nowrap"
            >↗</a>
          </div>
        ))}
      </div>
      <button type="button" onClick={onClose}
        className="px-[18px] py-3 rounded-[10px] bg-[var(--ink)] text-[var(--paper)] font-semibold text-[14px]">
        Cerrar
      </button>
    </div>
  )
}

// ── Atoms ──────────────────────────────────────────────────────────

function Field({ label, error, children }: { label: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] uppercase tracking-[0.06em] text-[var(--muted)] font-bold">{label}</label>
      {children}
      {error && <span className="text-[12px] text-[var(--rose-ink,#6f2920)]">{error}</span>}
    </div>
  )
}

function inputCls(invalid: boolean) {
  return [
    'px-3.5 py-[11px] bg-[var(--paper)] border rounded-[10px] text-[14px] text-[var(--ink)] w-full',
    invalid
      ? 'border-[var(--rose-ink,#6f2920)]'
      : 'border-[var(--line-strong)] focus:outline-none focus:border-[var(--ink)] focus:shadow-[0_0_0_3px_rgba(26,26,23,.08)]',
  ].join(' ')
}

function SummaryRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <tr className="border-b border-[var(--line)] last:border-b-0">
      <td className="px-4 py-2.5 text-[11px] uppercase tracking-[0.06em] text-[var(--muted)] font-semibold w-44">{k}</td>
      <td className={['px-4 py-2.5 text-[var(--ink)] font-medium', mono ? 'font-mono text-[13px]' : ''].join(' ')}>{v}</td>
    </tr>
  )
}

function Spinner() {
  return (
    <>
      <style>{`@keyframes iw-spin { to { transform: rotate(360deg); } }`}</style>
      <span
        className="inline-block w-10 h-10 rounded-full border-[2.5px] border-[var(--line)] border-t-[var(--accent)]"
        style={{ animation: 'iw-spin .9s linear infinite' }}
      />
    </>
  )
}
