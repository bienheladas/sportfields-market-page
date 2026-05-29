import * as React from 'react'
import { Data, Constr, applyParamsToScript, fromText } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  OWNERS_VALIDATOR_ADDR,
  OWNER_NFT_POLICY,
  COMPANY_PKH,
  OWNERS_MINT_COMPILED,
  REGISTRATION_FEE_LOVELACE,
  SCRIPT_LOVELACE,
} from '../lib/config'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'

// Pre-apply parameters: owners_minting_policy(companyPkh, registrationFee, collateral)
const appliedOwnersMint = applyParamsToScript(OWNERS_MINT_COMPILED, [
  new Constr(0, [COMPANY_PKH, 5_000_000n, 500_000_000n])
])

export interface RegisterOwnerFields {
  fieldName: string
  fieldAddress: string
  phone: string
  email: string
  lat: string
  long_: string
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
  return null
}

export function useRegisterOwner(): UseRegisterOwner {
  const { lucid, pkh: ownerPkh, address: ownerAddr } = useLucid()
  const [loading, setLoading] = React.useState(false)
  const [error, setError]     = React.useState<string | null>(null)

  const register = React.useCallback(
    async (fields: RegisterOwnerFields): Promise<string> => {
      if (!lucid) throw new Error('Conectá tu wallet para registrar tu cancha.')

      const validationError = validate(fields)
      if (validationError) throw new Error(validationError)

      setLoading(true)
      setError(null)

      try {
        // ── Token name = ownerPkh (28-byte hex) ───────────────────
        const tokenNameHex = ownerPkh
        const tokenUnit    = OWNER_NFT_POLICY + tokenNameHex

        // ── Mint redeemer: MintOwnerNFT = Constr 0 [ownerPkh] ────
        const mintRedeemer = Data.to(new Constr(0, [ownerPkh]))

        // ── Datum: DatumOwner = Constr 1 [OwnerRecord] ───────────
        const ownerRecord = new Constr(0, [
          tokenNameHex,                    // ownerNFTName = pkh
          ownerPkh,                        // ownerPkh
          0n,                              // rentalsCompleted
          0n,                              // rentalsRefunded
          0n,                              // rentalsDisputed
          0n,                              // rentNFTsProven
          fromText(fields.fieldName),      // fieldName
          fromText(fields.fieldAddress),   // address
          fromText(fields.phone),          // phone
          fromText(fields.email),          // email
          fromText(fields.lat),            // lat
          fromText(fields.long_),          // long
          ownerPkh,                        // paymentAddress = pkh raw
        ])
        const datum = Data.to(new Constr(1, [ownerRecord]))

        // ── Company address (receives registration fee) ───────────
        // We send to an address derived from company PKH on Preview
        const companyAddr = 'addr_test1vrs7gwjvkqyats7ka44y8pt5tcy5xc25y2k6hk5ey94ys3sm65ak6'

        // ── Build Tx ─────────────────────────────────────────────
        const tx = await lucid.newTx()
          .mintAssets({ [tokenUnit]: 1n }, mintRedeemer)
          .attach.MintingPolicy({ type: 'PlutusV3', script: appliedOwnersMint })
          .pay.ToContract(
            OWNERS_VALIDATOR_ADDR,
            { kind: 'inline', value: datum },
            { lovelace: SCRIPT_LOVELACE, [tokenUnit]: 1n },
          )
          .pay.ToAddress(companyAddr, { lovelace: REGISTRATION_FEE_LOVELACE })
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
