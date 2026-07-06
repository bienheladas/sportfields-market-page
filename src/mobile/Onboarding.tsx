// Onboarding.tsx — Mejora Q (modo app): crear o restaurar la wallet embebida.
// La seed se tipea/genera localmente y nunca sale del dispositivo (ver embeddedWallet.ts).

import * as React from 'react'
import { useLucid } from '../lib/LucidContext'
import {
  createSeed, getSeedStorage, normalizeSeed, probeSeedOnChain, seedWordCount,
  type SeedEvidence,
} from '../lib/embeddedWallet'
import { formatAda, shortenAddr } from '../components/lib'

type Mode = 'choose' | 'create' | 'restore'

export function Onboarding() {
  const [mode, setMode] = React.useState<Mode>('choose')

  return (
    <div className="min-h-screen bg-[var(--paper)] flex flex-col">
      <header className="px-6 pt-12 pb-6 text-center">
        <h1 className="m-0 text-[22px] font-bold tracking-[-0.015em] text-[var(--ink)]">Sportfields</h1>
        <p className="m-0 mt-1 text-[14px] text-[var(--muted)]">Tu cuenta para redimir reservas en la cancha</p>
      </header>

      <div className="flex-1 px-5 pb-10 max-w-[440px] w-full mx-auto">
        {mode === 'choose' && <ChooseStep onCreate={() => setMode('create')} onRestore={() => setMode('restore')} />}
        {mode === 'create' && <CreateStep onBack={() => setMode('choose')} />}
        {mode === 'restore' && <RestoreStep onBack={() => setMode('choose')} />}
      </div>
    </div>
  )
}

function ChooseStep({ onCreate, onRestore }: { onCreate: () => void; onRestore: () => void }) {
  return (
    <div className="flex flex-col gap-3 pt-8">
      <button
        type="button"
        onClick={onCreate}
        className="w-full text-left px-5 py-4 rounded-2xl bg-[var(--accent)] hover:bg-[var(--accent-deep)] text-white transition-colors"
      >
        <span className="block text-[15px] font-semibold">Crear cuenta nueva</span>
        <span className="block mt-0.5 text-[13px] opacity-85">Genera una billetera nueva en este teléfono</span>
      </button>
      <button
        type="button"
        onClick={onRestore}
        className="w-full text-left px-5 py-4 rounded-2xl bg-[var(--paper-2)] border border-[var(--line)] hover:border-[var(--line-strong)] text-[var(--ink)] transition-colors"
      >
        <span className="block text-[15px] font-semibold">Ya tengo una wallet</span>
        <span className="block mt-0.5 text-[13px] text-[var(--muted)]">Restaura con tu frase de recuperación (Lace, Eternl…)</span>
      </button>
      <p className="mt-4 text-[12px] leading-[1.5] text-[var(--muted)] text-center">
        Tu frase se guarda solo en este dispositivo. Nunca se envía a ningún servidor.
      </p>
    </div>
  )
}

function CreateStep({ onBack }: { onBack: () => void }) {
  const { connectWithSeed } = useLucid()
  const [seed] = React.useState(() => createSeed())
  const [saved, setSaved] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const words = seed.split(' ')

  const handleContinue = async () => {
    setBusy(true)
    setError(null)
    try {
      const storage = await getSeedStorage()
      await storage.save(seed)
      await connectWithSeed(seed)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <BackLink onBack={onBack} />
      <div>
        <h2 className="m-0 text-[17px] font-semibold text-[var(--ink)]">Tu frase de recuperación</h2>
        <p className="m-0 mt-1 text-[13px] leading-[1.5] text-[var(--muted)]">
          Escríbela en papel y guárdala en un lugar seguro. Es la única forma de recuperar
          tu cuenta si pierdes el teléfono.
        </p>
      </div>

      <ol className="m-0 p-3 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-2xl bg-[var(--paper-2)] border border-[var(--line)] list-none">
        {words.map((w, i) => (
          <li key={i} className="flex items-baseline gap-2 text-[14px]">
            <span className="w-6 text-right text-[12px] text-[var(--muted)] tabular-nums">{i + 1}.</span>
            <span className="font-medium text-[var(--ink)]">{w}</span>
          </li>
        ))}
      </ol>

      <label className="flex items-start gap-2.5 text-[13px] leading-[1.45] text-[var(--ink-2)] cursor-pointer">
        <input
          type="checkbox"
          checked={saved}
          onChange={e => setSaved(e.target.checked)}
          className="mt-0.5 accent-[var(--accent)]"
        />
        Guardé mi frase de recuperación en un lugar seguro. Entiendo que sin ella no puedo
        recuperar mi cuenta.
      </label>

      {error && <ErrorNote message={error} />}

      <button
        type="button"
        disabled={!saved || busy}
        onClick={handleContinue}
        className="w-full py-3 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-deep)] text-white text-[15px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? 'Creando…' : 'Continuar'}
      </button>
    </div>
  )
}

function RestoreStep({ onBack }: { onBack: () => void }) {
  const { connectWithSeed } = useLucid()
  const [input, setInput] = React.useState('')
  const [evidence, setEvidence] = React.useState<SeedEvidence | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const wordCount = seedWordCount(input)
  const plausible = wordCount === 12 || wordCount === 15 || wordCount === 24

  const handleVerify = async () => {
    setBusy(true)
    setError(null)
    try {
      setEvidence(await probeSeedOnChain(input))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg.includes('word') || msg.includes('mnemonic') || msg.includes('invalid')
        ? 'La frase no es válida. Revisa que las palabras estén bien escritas y en orden.'
        : msg)
    } finally {
      setBusy(false)
    }
  }

  const handleConfirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const seed = normalizeSeed(input)
      const storage = await getSeedStorage()
      await storage.save(seed)
      await connectWithSeed(seed)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const hasActivity = evidence !== null && (evidence.utxoCount > 0 || evidence.reservationCount > 0)

  return (
    <div className="flex flex-col gap-4">
      <BackLink onBack={onBack} />
      <div>
        <h2 className="m-0 text-[17px] font-semibold text-[var(--ink)]">Restaurar wallet</h2>
        <p className="m-0 mt-1 text-[13px] leading-[1.5] text-[var(--muted)]">
          Escribe tu frase de recuperación separando las palabras con espacios.
        </p>
      </div>

      <textarea
        value={input}
        onChange={e => { setInput(e.target.value); setEvidence(null) }}
        rows={4}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder="palabra1 palabra2 palabra3 …"
        className="w-full p-3.5 rounded-2xl bg-[var(--paper-2)] border border-[var(--line)] focus:border-[var(--line-strong)] outline-none text-[14px] text-[var(--ink)] resize-none"
      />
      <span className="text-[12px] text-[var(--muted)] -mt-2">
        {wordCount} {wordCount === 1 ? 'palabra' : 'palabras'}{plausible ? ' ✓' : ' (se esperan 12, 15 o 24)'}
      </span>

      {error && <ErrorNote message={error} />}

      {!evidence && (
        <button
          type="button"
          disabled={!plausible || busy}
          onClick={handleVerify}
          className="w-full py-3 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-deep)] text-white text-[15px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? 'Buscando en la red…' : 'Verificar cuenta'}
        </button>
      )}

      {evidence && (
        <div className="flex flex-col gap-3 p-4 rounded-2xl bg-[var(--paper-2)] border border-[var(--line)]">
          <p className="m-0 text-[13px] leading-[1.5] text-[var(--ink-2)]">
            Con esta frase encontramos en la red:
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="px-3 py-2.5 rounded-xl bg-[var(--paper)] border border-[var(--line)]">
              <span className="block text-[11px] text-[var(--muted)]">Balance</span>
              <span className="block mt-0.5 text-[15px] font-bold text-[var(--ink)] tabular-nums">{formatAda(evidence.lovelace)}</span>
            </div>
            <div className="px-3 py-2.5 rounded-xl bg-[var(--paper)] border border-[var(--line)]">
              <span className="block text-[11px] text-[var(--muted)]">Reservas activas</span>
              <span className="block mt-0.5 text-[15px] font-bold text-[var(--ink)] tabular-nums">{evidence.reservationCount}</span>
            </div>
          </div>
          <code className="block px-3 py-2 rounded-lg bg-[var(--paper)] border border-[var(--line)] text-[11px] break-all text-[var(--muted)]">
            {shortenAddr(evidence.address, 24, 12)}
          </code>

          {!hasActivity && (
            <div className="px-3 py-2.5 rounded-xl bg-[var(--amber-bg)] border border-[#ebd187] text-[12px] leading-[1.55] text-[var(--amber-ink)]">
              <strong className="font-semibold">Sin actividad con esta clave.</strong> Si tu wallet
              tiene fondos, probablemente usa otra cuenta o está en modo multi-dirección (esta app
              deriva la dirección base de la cuenta 0) — o está respaldada por un hardware wallet.
              Puedes continuar de todas formas: la app operará con esta cuenta nueva, y tus fondos y
              reservas de la otra wallet no aparecerán aquí.
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleConfirm}
              className="flex-1 py-2.5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-deep)] text-white text-[14px] font-semibold transition-colors disabled:opacity-40"
            >
              {busy ? 'Conectando…' : hasActivity ? 'Usar esta cuenta' : 'Continuar igual'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEvidence(null)}
              className="flex-1 py-2.5 rounded-xl bg-[var(--paper)] border border-[var(--line)] hover:border-[var(--line-strong)] text-[var(--ink)] text-[14px] font-semibold transition-colors"
            >
              Corregir frase
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="self-start -ml-1 px-1 py-0.5 text-[13px] font-medium text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
    >
      ← Volver
    </button>
  )
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="px-3.5 py-2.5 rounded-xl bg-[var(--rose-bg)] border border-[#ecb5ac] text-[13px] leading-[1.45] text-[var(--rose-ink)]">
      {message}
    </div>
  )
}
