// Tx: CollectSlot — owner spends Completed slot UTxO + Owner NFT, collects rent.

import { useState } from 'react'
import { Data, Constr, applyParamsToScript } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  OWNERS_VALIDATOR_ADDR,
  RENT_VALIDATOR_ADDR,
  RENT_NFT_POLICY,
  OWNER_NFT_POLICY,
  COMPANY_PKH,
  OWNERS_SPEND_COMPILED,
  RENT_SPEND_COMPILED,
} from '../lib/config'
import { getAddressUtxos } from '../lib/blockfrost'
import { decodeOwnersDatum } from '../lib/decoders'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'
import type { RentSlotUtxo } from './useRentSlots'

// Pre-apply parameters
const appliedOwnersSpend = applyParamsToScript(OWNERS_SPEND_COMPILED, [
  new Constr(0, [COMPANY_PKH, OWNER_NFT_POLICY])
])
const appliedRentSpend = applyParamsToScript(RENT_SPEND_COMPILED, [
  new Constr(0, [OWNER_NFT_POLICY, RENT_NFT_POLICY])
])

export function useCollectSlot() {
  const { lucid, pkh: ownerPkh, address: ownerAddr } = useLucid()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const collectSlot = async (slot: RentSlotUtxo): Promise<string> => {
    if (!lucid) throw new Error('Wallet no conectada')
    if (slot.datum.status !== 'Completed') throw new Error('Solo se puede cobrar un slot Completed')

    setLoading(true)
    setError(null)

    try {
      const datum = slot.datum

      // ── Find owner NFT UTxO in OwnersValidator ───────────────────
      const nftUnit = OWNER_NFT_POLICY + ownerPkh
      const ownerUtxos = await getAddressUtxos(OWNERS_VALIDATOR_ADDR)
      const ownerNftUtxo = ownerUtxos.find(u => u.amount.some(a => a.unit === nftUnit))
      if (!ownerNftUtxo) throw new Error('Owner NFT UTxO no encontrado en el contrato')
      if (!ownerNftUtxo.inline_datum) throw new Error('Owner NFT UTxO sin inline datum')

      const ownerRecord = decodeOwnersDatum(ownerNftUtxo.inline_datum)
      if (ownerRecord.kind !== 'Owner') throw new Error('Datum inesperado — no es OwnerRecord')

      const ownerLovelace = BigInt(ownerNftUtxo.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0')

      // ── Redeemers ────────────────────────────────────────────────
      // RentValidator: CollectSlot = Constr 5 []
      const rentSpendRedeemer   = Data.to(new Constr(5, []))
      // OwnersValidator: CollectPayments = Constr 1 []
      const ownersSpendRedeemer = Data.to(new Constr(1, []))

      // ── Updated OwnerRecord datum (increment rentalsCompleted) ───
      const rec = ownerRecord.record
      const updatedOwnerRecord = new Constr(0, [
        rec.ownerNFTName,
        rec.ownerPkh,
        BigInt(rec.rentalsCompleted) + 1n,
        BigInt(rec.rentalsRefunded),
        BigInt(rec.rentalsDisputed),
        BigInt(rec.rentNFTsProven),
        rec.fieldName,
        rec.address,
        rec.phone,
        rec.email,
        rec.lat,
        rec.long,
        rec.paymentAddress,
      ])
      const updatedOwnerDatum = Data.to(new Constr(1, [updatedOwnerRecord]))

      // ── Build Tx ─────────────────────────────────────────────────
      const tx = await lucid.newTx()
        // Spend rent slot UTxO
        .collectFrom(
          [{ txHash: slot.txHash, outputIndex: slot.outputIndex, address: slot.address,
             assets: { lovelace: slot.lovelace }, datum: slot.rawDatum }],
          rentSpendRedeemer,
        )
        .attach.SpendingValidator({ type: 'PlutusV3', script: appliedRentSpend })
        // Spend owner NFT UTxO
        .collectFrom(
          [{
            txHash: ownerNftUtxo.tx_hash,
            outputIndex: ownerNftUtxo.output_index,
            address: OWNERS_VALIDATOR_ADDR,
            assets: { lovelace: ownerLovelace, [nftUnit]: 1n },
            datum: ownerNftUtxo.inline_datum ?? '',
          }],
          ownersSpendRedeemer,
        )
        .attach.SpendingValidator({ type: 'PlutusV3', script: appliedOwnersSpend })
        // Return owner NFT + updated datum back to OwnersValidator
        .pay.ToContract(
          OWNERS_VALIDATOR_ADDR,
          { kind: 'inline', value: updatedOwnerDatum },
          { lovelace: ownerLovelace, [nftUnit]: 1n },
        )
        // Rent proceeds go to owner wallet (via change)
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

  return { collectSlot, loading, error }
}
