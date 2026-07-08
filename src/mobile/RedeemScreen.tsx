// RedeemScreen.tsx — Mejora Q (modo app): lista de reservas Confirmed y redención en la cancha.
// Ventana [slot_start−15min, week_end] validada client-side (el on-chain la exige igual);
// advertencia — no bloqueo — si el dispositivo está lejos del campo (la firma del cliente
// es la protección: redimir lejos solo lo perjudica a él).

import * as React from 'react'
import { useLucid } from '../lib/LucidContext'
import { useMyReservations } from '../hooks/useMyReservations'
import { useRedeemAtField } from '../hooks/useRedeemAtField'
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

  // Tick para la cuenta regresiva de la ventana de redención
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [])

  // Posición del dispositivo (best effort — si el usuario la niega, simplemente no se advierte).
  // En la app nativa se usa el plugin de Capacitor (maneja el prompt de permisos de Android/iOS,
  // cosa que navigator.geolocation no hace dentro del WebView); en browser, la API estándar.
  React.useEffect(() => {
    let cancelled = false
    const cap = (window as any).Capacitor
    if (cap?.isNativePlatform?.()) {
      import('@capacitor/geolocation')
        .then(({ Geolocation }) => Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10_000 }))
        .then(p => { if (!cancelled) setPos({ lat: p.coords.latitude, long: p.coords.longitude }) })
        .catch(() => { /* sin permiso o sin señal — la advertencia de distancia se omite */ })
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        p => { if (!cancelled) setPos({ lat: p.coords.latitude, long: p.coords.longitude }) },
        () => { /* sin permiso o sin señal — la advertencia de distancia se omite */ },
        { enableHighAccuracy: true, timeout: 10_000 },
      )
    }
    return () => { cancelled = true }
  }, [])

  const confirmed = slots.filter(s => s.datum.status === 'Confirmed')

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

      {!loading && !error && confirmed.length === 0 && (
        <div className="py-10 text-center">
          <p className="m-0 text-[14px] text-[var(--muted)]">No tienes reservas confirmadas.</p>
          <p className="m-0 mt-1 text-[13px] text-[var(--muted)]">Reserva desde la web y aparecerán aquí para redimir.</p>
        </div>
      )}

      {confirmed.map(slot => (
        <RedeemCard
          key={`${slot.txHash}#${slot.outputIndex}`}
          slot={slot}
          now={now}
          pos={pos}
          onRedeemed={reload}
        />
      ))}
    </div>
  )
}

function RedeemCard({ slot, now, pos, onRedeemed }: {
  slot: RentSlotUtxo
  now: number
  pos: GeoPos | null
  onRedeemed: () => void
}) {
  const { redeemAtField, loading } = useRedeemAtField()
  const [txHash, setTxHash] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const datum = slot.datum
  const opensAt = datum.slotStart - REDEEM_OPENS_BEFORE_MS
  const windowState: 'before' | 'open' | 'closed' =
    now < opensAt ? 'before' : now < datum.weekEnd ? 'open' : 'closed'

  // Al redimir, el cliente está (o debería estar) en la cancha — la zona horaria del
  // dispositivo coincide con la del campo, así que se usa directamente.
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone

  const fieldPos = parseLatLong(datum.lat, datum.long)
  const distanceM = pos && fieldPos ? haversineMeters(pos, fieldPos) : null
  const isFar = distanceM !== null && distanceM > FAR_FROM_FIELD_METERS

  const handleRedeem = async () => {
    setError(null)
    try {
      const hash = await redeemAtField(slot)
      setTxHash(hash)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (txHash) {
    return (
      <div className="p-4 rounded-2xl bg-[#eaf4ee] border border-[#bcd9c6]">
        <p className="m-0 text-[14px] font-semibold text-[#244d33]">✓ Reserva redimida</p>
        <p className="m-0 mt-1 text-[12px] leading-[1.5] text-[#3c6a4d]">
          El NFT de lealtad llegó a tu billetera. La confirmación en cadena tarda ~30 s.
        </p>
        <code className="block mt-2 px-2.5 py-1.5 rounded-lg bg-white/60 text-[11px] break-all text-[#244d33]">{txHash}</code>
        <button
          type="button"
          onClick={onRedeemed}
          className="mt-3 w-full py-2 rounded-xl bg-[var(--paper)] border border-[#bcd9c6] text-[#244d33] text-[13px] font-semibold"
        >
          Listo
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 rounded-2xl bg-[var(--paper-2)] border border-[var(--line)] flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 text-[15px] font-semibold text-[var(--ink)] truncate">{decodeBBS(datum.fieldName)}</h3>
          <p className="m-0 mt-0.5 text-[12px] text-[var(--muted)] truncate">{decodeBBS(datum.fieldAddress)}</p>
        </div>
        <span className="shrink-0 text-[13px] font-semibold text-[var(--ink)]">{formatAda(datum.rentPrice)}</span>
      </div>

      <p className="m-0 text-[13px] text-[var(--ink-2)]">
        {formatPosixDateTime(datum.slotStart, 'es', deviceTz)} · hora local
      </p>

      {isFar && windowState !== 'closed' && (
        <div className="px-3 py-2 rounded-xl bg-[var(--amber-bg)] border border-[#ebd187] text-[12px] leading-[1.45] text-[var(--amber-ink)]">
          ⚠ Estás a ~{formatDistance(distanceM!)} de la cancha. Redimir confirma que el servicio se
          cumplió y ya no podrás abrir una disputa.
        </div>
      )}

      {/* R/U: slots sin Rent NFT (lealtad apagada o pagados con lealtad) no se
          redimen — la reserva vale por sí sola y termina en Confirmed */}
      {!datum.rentNFTName && (
        <div className="w-full py-2.5 rounded-xl bg-[var(--paper)] border border-[var(--line)] text-[var(--ink-2)] text-[13px] font-semibold text-center">
          Reserva activa — preséntate en la cancha (sin redención on-chain)
        </div>
      )}
      {datum.rentNFTName && windowState === 'before' && (
        <button disabled className="w-full py-2.5 rounded-xl bg-[var(--paper)] border border-[var(--line)] text-[var(--muted)] text-[14px] font-semibold cursor-not-allowed">
          Abre en {formatCountdown(opensAt - now)}
        </button>
      )}
      {datum.rentNFTName && windowState === 'open' && (
        <button
          type="button"
          disabled={loading}
          onClick={handleRedeem}
          className="w-full py-2.5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-deep)] text-white text-[14px] font-semibold transition-colors disabled:opacity-50"
        >
          {loading ? 'Firmando y enviando…' : 'Estoy en la cancha — redimir'}
        </button>
      )}
      {datum.rentNFTName && windowState === 'closed' && (
        <button disabled className="w-full py-2.5 rounded-xl bg-[var(--paper)] border border-[var(--line)] text-[var(--muted)] text-[14px] font-semibold cursor-not-allowed">
          Ventana de redención cerrada
        </button>
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
