import * as React from 'react'
import { Data, Constr, applyParamsToScript, fromText } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  OWNERS_VALIDATOR_ADDR,
  OWNER_NFT_POLICY,
  COMPANY_PKH,
  COMPANY_ADDR,
  OWNERS_MINT_COMPILED,
  REGISTRATION_FEE_LOVELACE,
  SCRIPT_LOVELACE,
} from '../lib/config'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'

// Cardano tx metadata caps each string chunk at 64 UTF-8 *bytes*, not JS string
// length (UTF-16 code units) — a chunk of 64 *characters* containing accented
// letters (á, é, í, ó, ú, ñ — 2 bytes each in UTF-8) can silently encode to 65+
// bytes and fail with "Deserialization: 65 not at most 64". Chunk by byte
// length instead, backing off so a multi-byte character is never split in half.
function metaStr(s: string): string | string[] {
  const bytes = new TextEncoder().encode(s)
  if (bytes.length <= 64) return s
  const chunks: string[] = []
  let start = 0
  while (start < bytes.length) {
    let end = Math.min(start + 64, bytes.length)
    while (end > start && (bytes[end] & 0xc0) === 0x80) end--
    chunks.push(new TextDecoder().decode(bytes.slice(start, end)))
    start = end
  }
  return chunks
}

function makeOwnerNftImage(): string[] {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="96" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0%" stop-color="#ef4444"/>` +
    `<stop offset="100%" stop-color="#7f1d1d"/>` +
    `</linearGradient></defs>` +
    `<rect width="96" height="96" rx="10" fill="url(#g)"/>` +
    `<rect x="8" y="16" width="80" height="64" rx="2" stroke="rgba(255,255,255,.5)" stroke-width="1.5" fill="none"/>` +
    `<line x1="48" y1="16" x2="48" y2="80" stroke="rgba(255,255,255,.5)" stroke-width="1.5"/>` +
    `<circle cx="48" cy="48" r="12" stroke="rgba(255,255,255,.5)" stroke-width="1.5" fill="none"/>` +
    `<circle cx="48" cy="48" r="2" fill="rgba(255,255,255,.7)"/>` +
    `<rect x="8" y="33" width="14" height="30" stroke="rgba(255,255,255,.35)" stroke-width="1" fill="none"/>` +
    `<rect x="74" y="33" width="14" height="30" stroke="rgba(255,255,255,.35)" stroke-width="1" fill="none"/>` +
    `</svg>`
  const dataUri = `data:image/svg+xml;base64,${btoa(svg)}`
  const chunks: string[] = []
  for (let i = 0; i < dataUri.length; i += 64) chunks.push(dataUri.slice(i, i + 64))
  return chunks
}

// Pre-apply parameters: owners_minting_policy(companyPkh, registrationFee, collateral)
// collateral=0n en este deploy (la garantía dinámica por slot cubre el colateral)
const appliedOwnersMint = applyParamsToScript(OWNERS_MINT_COMPILED, [
  new Constr(0, [COMPANY_PKH, 5_000_000n, 0n])
])

export interface RegisterOwnerFields {
  fieldName: string
  fieldAddress: string
  phone: string
  email: string
  lat: string
  long_: string
  /** Mejora L — IANA timezone string, ej. "America/Guatemala". */
  timezone: string
}

export interface UseRegisterOwner {
  register: (fields: RegisterOwnerFields) => Promise<string>
  loading: boolean
  error: string | null
}

const LIMITS = {
  fieldName: 64,
  fieldAddress: 64,
  phone: 32,
  email: 64,
} as const

const LATLONG_RE = /^-?\d+\.\d+$/

function validate(f: RegisterOwnerFields): string | null {
  const utf8Len = (s: string) => new TextEncoder().encode(s).length
  if (!f.fieldName.trim()) return 'El nombre del campo es requerido.'
  if (utf8Len(f.fieldName) > LIMITS.fieldName)
    return `El nombre del campo no puede superar ${LIMITS.fieldName} bytes UTF-8.`
  if (!f.fieldAddress.trim()) return 'La dirección es requerida.'
  if (utf8Len(f.fieldAddress) > LIMITS.fieldAddress)
    return `La dirección no puede superar ${LIMITS.fieldAddress} bytes UTF-8.`
  if (!f.phone.trim()) return 'El teléfono es requerido.'
  if (utf8Len(f.phone) > LIMITS.phone)
    return `El teléfono no puede superar ${LIMITS.phone} bytes.`
  if (!f.email.trim()) return 'El email es requerido.'
  if (utf8Len(f.email) > LIMITS.email)
    return `El email no puede superar ${LIMITS.email} bytes.`
  if (!LATLONG_RE.test(f.lat)) return 'La latitud debe ser un número decimal (ej. -34.6037).'
  if (!LATLONG_RE.test(f.long_)) return 'La longitud debe ser un número decimal (ej. -58.3816).'
  if (!f.timezone.trim()) return 'La zona horaria (IANA) es requerida.'
  return null
}

export function useRegisterOwner(): UseRegisterOwner {
  const { lucid, pkh: ownerPkh, address: ownerAddr } = useLucid()
  const [loading, setLoading] = React.useState(false)
  const [error, setError]     = React.useState<string | null>(null)

  const register = React.useCallback(
    async (fields: RegisterOwnerFields): Promise<string> => {
      if (!lucid) throw new Error('Conecta tu wallet para registrar tu cancha.')

      const validationError = validate(fields)
      if (validationError) throw new Error(validationError)

      setLoading(true)
      setError(null)

      try {
        // ── Token name = ownerPkh (28 B) + random 4 B suffix = 32 B ──
        const randomSuffix = Array.from(crypto.getRandomValues(new Uint8Array(4)))
          .map(b => b.toString(16).padStart(2, '0')).join('')
        const tokenNameHex = ownerPkh + randomSuffix
        const tokenUnit    = OWNER_NFT_POLICY + tokenNameHex

        // ── Mint redeemer: MintOwnerNFT = Constr 0 [ownerPkh] ────
        const mintRedeemer = Data.to(new Constr(0, [ownerPkh]))

        // guarantee_per_slot: rent_price × guarantee_bps / 10000
        // 20 ADA × 2000 / 10000 = 4 ADA — debe coincidir con init-week.mjs
        const guaranteePerSlot = 4_000_000n

        // ── Datum: DatumOwner = Constr 1 [OwnerRecord (16 campos)] ─
        const ownerRecord = new Constr(0, [
          tokenNameHex,                    // 0: ownerNFTName = pkh
          ownerPkh,                        // 1: ownerPkh
          0n,                              // 2: rentalsCompleted
          0n,                              // 3: rentalsRefunded
          0n,                              // 4: rentalsDisputed
          0n,                              // 5: rentNFTsProven
          fromText(fields.fieldName),      // 6: fieldName
          fromText(fields.fieldAddress),   // 7: address
          fromText(fields.phone),          // 8: phone
          fromText(fields.email),          // 9: email
          fromText(fields.lat),            // 10: lat
          fromText(fields.long_),          // 11: long
          ownerPkh,                        // 12: paymentAddress = pkh raw
          guaranteePerSlot,                // 13: guarantee_per_slot (vestigial display value — M3)
          0n,                               // 14: active_weeks_count = 0 (M3 — multiple concurrent weeks allowed)
          fromText(fields.timezone),       // 15: timezone (Mejora L)
        ])
        const datum = Data.to(new Constr(1, [ownerRecord]))

        // ── Build Tx ─────────────────────────────────────────────
        // G: NFT → owner's wallet (transferable); stats UTxO → contract (sin NFT)
        const ownerWalletAddr = await lucid.wallet().address()
        const ownerNftImage = makeOwnerNftImage()
        const tx = await lucid.newTx()
          .mintAssets({ [tokenUnit]: 1n }, mintRedeemer)
          .attach.MintingPolicy({ type: 'PlutusV3', script: appliedOwnersMint })
          .attachMetadata(721, {
            [OWNER_NFT_POLICY]: {
              [tokenNameHex]: {
                name: metaStr(`${fields.fieldName} — Propietario`),
                description: metaStr(`NFT de propietario para "${fields.fieldName}" en Sportfields.`),
                image: ownerNftImage,
              },
            },
          })
          // Stats UTxO al contrato — sin NFT
          .pay.ToContract(
            OWNERS_VALIDATOR_ADDR,
            { kind: 'inline', value: datum },
            { lovelace: SCRIPT_LOVELACE },
          )
          // NFT → wallet del owner (mejora G: transferible)
          .pay.ToAddress(ownerWalletAddr, { lovelace: 2_000_000n, [tokenUnit]: 1n })
          // Fee de registro → company
          .pay.ToAddress(COMPANY_ADDR, { lovelace: REGISTRATION_FEE_LOVELACE })
          .addSignerKey(ownerPkh)
          .complete()

        const signed = await tx.sign.withWallet().complete()
        const txHash = await signed.submit()
        return txHash
      } catch (e) {
        const msg = unwrapSubmitError(e)
        setError(msg)
        throw new Error(msg)
      } finally {
        setLoading(false)
      }
    },
    [lucid, ownerPkh, ownerAddr],
  )

  return { register, loading, error }
}
