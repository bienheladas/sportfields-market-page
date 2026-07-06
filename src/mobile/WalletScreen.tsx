// WalletScreen.tsx — Mejora Q (modo app): fondeo y estado de la wallet embebida.
// Dirección con copiar + QR, balance y NFTs de lealtad acumulados.

import * as React from 'react'
import QRCode from 'qrcode'
import { useLucid } from '../lib/LucidContext'
import { getAddressUtxos } from '../lib/blockfrost'
import { getSeedStorage } from '../lib/embeddedWallet'
import { RENT_NFT_POLICY } from '../lib/config'
import { formatAda, shortenAddr } from '../components/lib'

export function WalletScreen() {
  const { address, disconnect } = useLucid()
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [balance, setBalance] = React.useState<bigint | null>(null)
  const [loyaltyCount, setLoyaltyCount] = React.useState<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!address) return
    let cancelled = false
    QRCode.toDataURL(address, { margin: 2, width: 240 })
      .then(url => { if (!cancelled) setQrDataUrl(url) })
      .catch(() => { /* QR es cosmético — la dirección copiable sigue disponible */ })
    return () => { cancelled = true }
  }, [address])

  const loadBalance = React.useCallback(() => {
    if (!address) return
    setError(null)
    getAddressUtxos(address)
      .then(utxos => {
        let lovelace = 0n
        let nfts = 0
        for (const u of utxos) {
          for (const a of u.amount) {
            if (a.unit === 'lovelace') lovelace += BigInt(a.quantity)
            else if (a.unit.startsWith(RENT_NFT_POLICY)) nfts += Number(a.quantity)
          }
        }
        setBalance(lovelace)
        setLoyaltyCount(nfts)
      })
      .catch(e => setError(String(e)))
  }, [address])

  React.useEffect(() => { loadBalance() }, [loadBalance])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const handleLogout = async () => {
    const storage = await getSeedStorage()
    await storage.clear()
    disconnect()
  }

  return (
    <div className="flex flex-col gap-4 px-5 py-6 max-w-[440px] w-full mx-auto">
      <section className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-[var(--paper-2)] border border-[var(--line)]">
        <h2 className="m-0 text-[15px] font-semibold text-[var(--ink)]">Recibir fondos</h2>
        {qrDataUrl && (
          <img
            src={qrDataUrl}
            alt="QR de tu dirección"
            className="w-[200px] h-[200px] rounded-xl border border-[var(--line)] bg-white"
          />
        )}
        <code className="block px-3 py-2 rounded-lg bg-[var(--paper)] border border-[var(--line)] text-[12px] break-all text-center text-[var(--ink)]">
          {shortenAddr(address, 20, 10)}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="w-full py-2.5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-deep)] text-white text-[14px] font-semibold transition-colors"
        >
          {copied ? 'Copiada ✓' : 'Copiar dirección'}
        </button>
        <p className="m-0 text-[12px] leading-[1.5] text-[var(--muted)] text-center">
          Envía ADA a esta dirección para pagar tus reservas y las comisiones de red.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <StatCard label="Balance" value={balance === null ? '…' : formatAda(balance)} />
        <StatCard label="NFTs de lealtad" value={loyaltyCount === null ? '…' : String(loyaltyCount)} />
      </section>

      {error && (
        <div role="alert" className="px-3.5 py-2.5 rounded-xl bg-[var(--rose-bg)] border border-[#ecb5ac] text-[13px] text-[var(--rose-ink)]">
          No se pudo cargar el balance. <button type="button" onClick={loadBalance} className="underline font-semibold">Reintentar</button>
        </div>
      )}

      <button
        type="button"
        onClick={handleLogout}
        className="mt-2 w-full py-2.5 rounded-xl bg-[var(--paper-2)] border border-[var(--line)] hover:border-[var(--line-strong)] text-[var(--ink-2)] text-[13px] font-semibold transition-colors"
      >
        Cerrar sesión en este dispositivo
      </button>
      <p className="m-0 -mt-2 text-[11px] leading-[1.5] text-[var(--muted)] text-center">
        Cerrar sesión borra la frase de este dispositivo. Solo podrás volver a entrar
        restaurándola de nuevo.
      </p>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4 rounded-2xl bg-[var(--paper-2)] border border-[var(--line)]">
      <span className="block text-[12px] text-[var(--muted)]">{label}</span>
      <span className="block mt-1 text-[18px] font-bold tracking-[-0.01em] text-[var(--ink)] tabular-nums">{value}</span>
    </div>
  )
}
