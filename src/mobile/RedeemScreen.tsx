// RedeemScreen.tsx — Mejora Q (modo app): lista de reservas + redención + cancelación.
// Muestra slots Confirmed (redimibles + cancelables) y Pending (solo cancelables).
// Ventana [slot_start−15min, week_end] validada client-side (el on-chain la exige igual);
// advertencia — no bloqueo — si el dispositivo está lejos del campo.

import * as React from 'react'
import { useLucid } from '../lib/LucidContext'
import { useMyReservations } from '../hooks/useMyReservations'
import { useRedeemAtField } from '../hooks/useRedeemAtField'
import { useCancelRent } from '../hooks/useCancelRent'
import type { RentSlotUtxo } from '../hooks/useRentSlots'
import { decodeBBS, formatAda, formatPosixDateTime, parseLatLong } from '../components/lib'

const REDEEM_OPENS_BEFORE_MS = 15 * 60_000
const FAR_FROM_FIELD_METERS = 1_000

type GeoPos = { lat: number; long: number }

export function RedeemScreen() {
  const { pkh } = useLucid()
  const { slots, loading, error, reload } = useMyReservations(pkh || null)
  const [now, setNow] = React.useState(() => Date.now())
  const [pos, setPos] = React.useState<GeoPos | null>(null)

  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [])

  React.useEffect(() => {
    let cancelled = false
    const cap = (window as any).Capacitor
    if (cap?.isNativePlatform?.()) {
      import('@capacitor/geolocation')
        .then(({ Geolocation }) => Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10_000 }))
        .then(p => { if (!cancelled) setPos({ lat: p.coords.latitude, long: p.coords.longitude }) })
        .catch(() => {})
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        p => { if (!cancelled) setPos({ lat: p.coords.latitude, long: p.coords.longitude }) },
        () => {},
        { enableHighAccuracy: true, timeout: 10_000 },
      )
    }
    return () => { cancelled = true }
  }, [])

  // Show Confirmed and Pending slots (Pending can be cancelled, Confirmed can also be redeemed)
  const active = slots.filter(s => s.datum.status === 'Confirmed' || s.datum.status === 'Pending')

  return (
    <div className="flex flex-col gap-3 px-5 py-6 max-w-[440px] w-full mx-auto">
      <div className="flex items-baseline justify-between">
        <h2 className="m-0 text-[17px] font-semibold text-[var(--ink)]">Mis reservas</h2>
        <button
          type="button"
          onClick={reload}
          className="text-[13px] font-medium text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
        >
          Actualizar
        </button>
      </div>

      {loading && <p className="m-0 py-8 text-center text-[14px] text-[var(--muted)]">Cargando reservas…</p>}

      {error && (
        <div role="alert" className="px-3.5 py-2.5 rounded-xl bg-[var(--rose-bg)] border border-[#ecb5ac] text-[13px] text-[var(--rose-ink)]">
          No se pudieron cargar tus reservas. <button type="button" onClick={reload} className="underline font-semibold">Reintentar</button>
        </div>
      )}

      {!loading && !error && active.length === 0 && (
        <div className="py-10 text-center">
          <p className="m-0 text-[14px] text-[var(--muted)]">No tienes reservas activas.</p>
          <p className="m-0 mt-1 text-[13px] text-[var(--muted)]">Reserva desde la web y aparecerán aquí.</p>
        </div>
      )}

      {active.map(slot => (
        <ReservationCard
          key={`${slot.txHash}#${slot.outputIndex}`}
          slot={slot}
          now={now}
          pos={pos}
          onDone={reload}
        />
      ))}
    </div>
  )
}

function ReservationCard({ slot, now, pos, onDone }: {
  slot: RentSlotUtxo
  now: number
  pos: GeoPos | null
  onDone: () => void
}) {
  const { redeemAtField, loading: redeeming } = useRedeemAtField()
  const { cancel, loading: cancelling } = useCancelRent()

  const [txHash, setTxHash] = React.useState<string | null>(null)
  const [txKind, setTxKind] = React.useState<'redeemed' | 'cancelled' | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = React.useState(false)

  const datum = slot.datum
  const opensAt = datum.slotStart - REDEEM_OPENS_BEFORE_MS
  const redeemWindowState: 'before' | 'open' | 'closed' =
    now < opensAt ? 'before' : now < datum.weekEnd ? 'open' : 'closed'

  const canCancel = now < datum.cancelDeadline
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone

  const fieldPos = parseLatLong(datum.lat, datum.long)
  const distanceM = pos && fieldPos ? haversineMeters(pos, fieldPos) : null
  const isFar = distanceM !== null && distanceM > FAR_FROM_FIELD_METERS

  const handleRedeem = async () => {
    setError(null)
    setConfirmCancel(false)
    try {
      const hash = await redeemAtField(slot)
      setTxHash(hash)
      setTxKind('redeemed')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleCancel = async () => {
    setError(null)
    try {
      const hash = await cancel(slot)
      setTxHash(hash)
      setTxKind('cancelled')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setConfirmCancel(false)
    }
  }

  if (txHash && txKind === 'redeemed') {
    return (
      <div className="p-4 rounded-2xl bg-[#eaf4ee] border border-[#bcd9c6]">
        <p className="m-0 text-[14px] font-semibold text-[#244d33]">✓ Reserva redimida</p>
        <p className="m-0 mt-1 text-[12px] leading-[1.5] text-[#3c6a4d]">
          El NFT de lealtad llegó a tu billetera. La confirmación en cadena tarda ~30 s.
        </p>
        <code className="block mt-2 px-2.5 py-1.5 rounded-lg bg-white/60 text-[11px] break-all text-[#244d33]">{txHash}</code>
        <button type="button" onClick={onDone}
          className="mt-3 w-full py-2 rounded-xl bg-[var(--paper)] border border-[#bcd9c6] text-[#244d33] text-[13px] font-semibold">
          Listo
        </button>
      </div>
    )
  }

  if (txHash && txKind === 'cancelled') {
    return (
      <div className="p-4 rounded-2xl bg-[var(--paper-2)] border border-[var(--line)]">
        <p className="m-0 text-[14px] font-semibold text-[var(--ink)]">Reserva cancelada</p>
        <p className="m-0 mt-1 text-[12px] leading-[1.5] text-[var(--ink-2)]">
          El reembolso de {formatAda(datum.rentPrice)} llegará a tu billetera en ~30 s.
        </p>
        <code className="block mt-2 px-2.5 py-1.5 rounded-lg bg-[var(--paper)] border border-[var(--line)] text-[11px] break-all text-[var(--muted)]">{txHash}</code>
        <button type="button" onClick={onDone}
          className="mt-3 w-full py-2 rounded-xl bg-[var(--paper)] border border-[var(--line)] text-[var(--ink)] text-[13px] font-semibold">
          Cerrar
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 rounded-2xl bg-[var(--paper-2)] border border-[var(--line)] flex flex-col gap-2.5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 text-[15px] font-semibold text-[var(--ink)] truncate">{decodeBBS(datum.fieldName)}</h3>
          <p className="m-0 mt-0.5 text-[12px] text-[var(--muted)] truncate">{decodeBBS(datum.fieldAddress)}</p>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          <span className="text-[13px] font-semibold text-[var(--ink)]">{formatAda(datum.rentPrice)}</span>
          {datum.status === 'Pending' && (
            <span className="px-2 py-0.5 rounded-full bg-[var(--amber-bg)] border border-[#ebd187] text-[11px] font-semibold text-[var(--amber-ink)]">
              Pendiente
            </span>
          )}
        </div>
      </div>

      <p className="m-0 text-[13px] text-[var(--ink-2)]">
        {formatPosixDateTime(datum.slotStart, 'es', deviceTz)} · hora local
      </p>

      {/* Distance warning (only for Confirmed in redeem window) */}
      {isFar && datum.status === 'Confirmed' && redeemWindowState !== 'closed' && (
        <div className="px-3 py-2 rounded-xl bg-[var(--amber-bg)] border border-[#ebd187] text-[12px] leading-[1.45] text-[var(--amber-ink)]">
          ⚠ Estás a ~{formatDistance(distanceM!)} de la cancha. Redimir confirma que el servicio
          se cumplió y ya no podrás abrir una disputa.
        </div>
      )}

      {/* Cancel deadline warning */}
      {canCancel && (
        <p className="m-0 text-[12px] text-[var(--muted)]">
          Cancelación disponible hasta: {formatPosixDateTime(datum.cancelDeadline, 'es', deviceTz)}
        </p>
      )}

      {/* Redeem button — only for Confirmed slots with NFT */}
      {datum.status === 'Confirmed' && datum.rentNFTName && redeemWindowState === 'before' && !confirmCancel && (
        <button disabled className="w-full py-2.5 rounded-xl bg-[var(--paper)] border border-[var(--line)] text-[var(--muted)] text-[14px] font-semibold cursor-not-allowed">
          Abre en {formatCountdown(opensAt - now)}
        </button>
      )}
      {datum.status === 'Confirmed' && datum.rentNFTName && redeemWindowState === 'open' && !confirmCancel && (
        <button
          type="button"
          disabled={redeeming || cancelling}
          onClick={handleRedeem}
          className="w-full py-2.5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-deep)] text-white text-[14px] font-semibold transition-colors disabled:opacity-50"
        >
          {redeeming ? 'Firmando y enviando…' : 'Estoy en la cancha — redimir'}
        </button>
      )}
      {datum.status === 'Confirmed' && datum.rentNFTName && redeemWindowState === 'closed' && !confirmCancel && (
        <button disabled className="w-full py-2.5 rounded-xl bg-[var(--paper)] border border-[var(--line)] text-[var(--muted)] text-[14px] font-semibold cursor-not-allowed">
          Ventana de redención cerrada
        </button>
      )}
      {/* Confirmed slot without NFT (lealtad apagada o pagado con lealtad) */}
      {datum.status === 'Confirmed' && !datum.rentNFTName && !confirmCancel && (
        <div className="w-full py-2.5 rounded-xl bg-[var(--paper)] border border-[var(--line)] text-[var(--ink-2)] text-[13px] font-semibold text-center">
          Reserva activa — preséntate en la cancha (sin redención on-chain)
        </div>
      )}

      {/* Cancel section */}
      {!confirmCancel && canCancel && !redeeming && (
        <button
          type="button"
          disabled={cancelling}
          onClick={() => { setError(null); setConfirmCancel(true) }}
          className="w-full py-2 rounded-xl bg-[var(--paper)] border border-[var(--line)] text-[var(--rose-ink)] text-[13px] font-semibold hover:bg-[var(--rose-bg)] transition-colors disabled:opacity-50"
        >
          Cancelar reserva
        </button>
      )}

      {/* Inline cancel confirmation */}
      {confirmCancel && (
        <div className="rounded-xl bg-[var(--rose-bg)] border border-[#ecb5ac] p-3.5 flex flex-col gap-2.5">
          <p className="m-0 text-[13px] font-semibold text-[var(--rose-ink)]">¿Cancelar esta reserva?</p>
          <p className="m-0 text-[12px] leading-[1.45] text-[var(--rose-ink)]">
            Recibirás {formatAda(datum.rentPrice)} de reembolso en tu billetera.
            Esta acción no se puede deshacer.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={cancelling}
              onClick={handleCancel}
              className="flex-1 py-2 rounded-xl bg-[var(--rose-ink)] text-white text-[13px] font-semibold disabled:opacity-50"
            >
              {cancelling ? 'Enviando…' : 'Sí, cancelar'}
            </button>
            <button
              type="button"
              disabled={cancelling}
              onClick={() => setConfirmCancel(false)}
              className="flex-1 py-2 rounded-xl bg-[var(--paper)] border border-[#ecb5ac] text-[var(--rose-ink)] text-[13px] font-semibold disabled:opacity-50"
            >
              No, volver
            </button>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="px-3 py-2 rounded-xl bg-[var(--rose-bg)] border border-[#ecb5ac] text-[12px] leading-[1.45] text-[var(--rose-ink)] break-words">
          {error}
        </div>
      )}
    </div>
  )
}

function haversineMeters(a: GeoPos, b: GeoPos): number {
  const R = 6_371_000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.long - a.long)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function formatDistance(meters: number): string {
  return meters >= 1_000 ? `${(meters / 1_000).toFixed(1)} km` : `${Math.round(meters)} m`
}

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1_000))
  const d = Math.floor(totalSec / 86_400)
  const h = Math.floor((totalSec % 86_400) / 3_600)
  const m = Math.floor((totalSec % 3_600) / 60)
  const s = totalSec % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}:${String(s).padStart(2, '0')}`
}
