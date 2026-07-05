// Tx: DeregisterField — owner deregisters their field, burning the Owner NFT
// and consuming the stats UTxO. Owner-initiated only — registering is
// unilateral (owner sig + fee), so deregistering mirrors that. The company
// co-sign previously required here enforced no actual on-chain condition
// (no rule was attached to it), so it was removed — single signature, single tx.

import { useState } from 'react'
import { Data, Constr, applyParamsToScript } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  OWNERS_VALIDATOR_ADDR,
  OWNER_NFT_POLICY,
  COMPANY_PKH,
  RENT_VALIDATOR_HASH,
  REGISTRATION_FEE_LOVELACE,
  OWNERS_SPEND_COMPILED,
  OWNERS_MINT_COMPILED,
} from '../lib/config'
import { getAddressUtxos } from '../lib/blockfrost'
import { decodeOwnersDatum } from '../lib/decoders'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'

const appliedOwnersSpend = applyParamsToScript(OWNERS_SPEND_COMPILED, [
  new Constr(0, [COMPANY_PKH, OWNER_NFT_POLICY, RENT_VALIDATOR_HASH])
])
const appliedOwnersMint = applyParamsToScript(OWNERS_MINT_COMPILED, [
  new Constr(0, [COMPANY_PKH, REGISTRATION_FEE_LOVELACE, 0n])
])

export function useDeregisterOwner() {
  const { lucid, pkh: ownerPkh } = useLucid()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const deregister = async (ownerNFTName: string): Promise<string> => {
    if (!lucid || !ownerPkh) throw new Error('Wallet no conectada')

    setLoading(true)
    setError(null)

    try {
      const ownerNftUnit = OWNER_NFT_POLICY + ownerNFTName
      const ownersUtxos = await getAddressUtxos(OWNERS_VALIDATOR_ADDR)

      const statsRaw = ownersUtxos.find(u => {
        if (!u.inline_datum) return false
        try {
          const d = decodeOwnersDatum(u.inline_datum)
          return d.kind === 'Owner' && d.record.ownerNFTName === ownerNFTName
        } catch { return false }
      })
      if (!statsRaw) throw new Error('Stats UTxO no encontrado para este owner')

      const record = decodeOwnersDatum(statsRaw.inline_datum!)
      if (record.kind !== 'Owner') throw new Error('Datum inesperado')
      if (record.record.activeWeeksCount !== 0)
        throw new Error('active_weeks_count != 0 — cerrá todas las semanas activas (Cerrar semana) antes de deregistrar.')

      const walletUtxos = await lucid.wallet().getUtxos()
      const nftUtxo = walletUtxos.find(u => (u.assets[ownerNftUnit] ?? 0n) >= 1n)
      if (!nftUtxo) throw new Error('Owner NFT no encontrado en tu wallet')

      const deregisterRedeemer = Data.to(new Constr(7, []))  // DeregisterField (owners_spend)
      const burnRedeemer       = Data.to(new Constr(1, []))  // BurnOwnerNFT (owners_minting)

      const tx = await lucid.newTx()
        .collectFrom(
          [{
            txHash: statsRaw.tx_hash,
            outputIndex: statsRaw.output_index,
            address: OWNERS_VALIDATOR_ADDR,
            assets: Object.fromEntries(statsRaw.amount.map(a => [a.unit, BigInt(a.quantity)])),
            datum: statsRaw.inline_datum!,
          }],
          deregisterRedeemer,
        )
        .attach.SpendingValidator({ type: 'PlutusV3', script: appliedOwnersSpend })
        .mintAssets({ [ownerNftUnit]: -1n }, burnRedeemer)
        .attach.MintingPolicy({ type: 'PlutusV3', script: appliedOwnersMint })
        .addSignerKey(ownerPkh)
        .complete()

      const signed = await tx.sign.withWallet().complete()
      return await signed.submit()
    } catch (e: unknown) {
      const msg = unwrapSubmitError(e)
      setError(msg)
      throw new Error(msg)
    } finally {
      setLoading(false)
    }
  }

  return { deregister, loading, error }
}
