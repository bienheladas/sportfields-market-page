// Tx: CancelRent (REMOVE) — burns Rent NFT, removes slot node from linked list.
// Spends predecessor with RemovePrev { new_next: slot.next } + slot with CancelRent.
// Refunds rentPrice to customer. No continuing slot output.

import { useState } from 'react'
import { Data, Constr, applyParamsToScript } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  RENT_VALIDATOR_ADDR,
  RENT_NFT_POLICY,
  COMPANY_PKH,
  OWNER_NFT_POLICY,
  RENT_SPEND_COMPILED,
  RENT_MINT_COMPILED,
} from '../lib/config'
import { decodeRentDatum } from '../lib/decoders'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'
import type { RentSlotUtxo } from './useRentSlots'
import type { NodeKey } from '../components/types'

const appliedRentSpend = applyParamsToScript(RENT_SPEND_COMPILED, [
  new Constr(0, [OWNER_NFT_POLICY, RENT_NFT_POLICY])
])
const appliedRentMint = applyParamsToScript(RENT_MINT_COMPILED, [
  new Constr(0, [COMPANY_PKH])
])

function nodeKeyConstr(nk: NodeKey): Constr<Data> {
  return nk.tag === 'Empty' ? new Constr(1, []) : new Constr(0, [BigInt(nk.key)])
}

function rebuildPredDatum(rawDatum: string, newNextConstr: Constr<Data>): string {
  const outer = Data.from(rawDatum) as Constr<Data>
  const inner = outer.fields[0] as Constr<Data>
  const nextIdx = Number(outer.index) === 0 ? 11 : 20
  const newFields = [...inner.fields]
  newFields[nextIdx] = newNextConstr
  return Data.to(new Constr(Number(outer.index), [new Constr(Number(inner.index), newFields)]))
}

export function useCancelRent() {
  const { lucid, pkh: customerPkh, address: customerAddr } = useLucid()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const cancel = async (slot: RentSlotUtxo): Promise<string> => {
    if (!lucid) throw new Error('Wallet no conectada')

    setLoading(true)
    setError(null)

    try {
      const datum = slot.datum

      // Fetch fresh UTxOs to locate the predecessor
      const allUtxos = await lucid.utxosAt(RENT_VALIDATOR_ADDR)

      // Find predecessor: UTxO whose next = Key(slot.slotId)
      let predUtxo: typeof allUtxos[0] | null = null
      let predRawDatum = ''
      for (const u of allUtxos) {
        if (!u.datum) continue
        if (u.txHash === slot.txHash && u.outputIndex === slot.outputIndex) continue
        try {
          // Try as Node
          const d = decodeRentDatum(u.datum)
          if (d && d.next.tag === 'Key' && d.next.key === datum.slotId) {
            predUtxo = u; predRawDatum = u.datum; break
          }
        } catch { /* skip */ }
        // Try as Head
        try {
          const outer = Data.from(u.datum) as Constr<Data>
          if (Number(outer.index) === 0) {
            const inner = outer.fields[0] as Constr<Data>
            const nextField = inner.fields[11] as Constr<Data>
            if (Number(nextField.index) === 0 && BigInt(String(nextField.fields[0])) === BigInt(datum.slotId)) {
              predUtxo = u; predRawDatum = u.datum; break
            }
          }
        } catch { /* skip */ }
      }
      if (!predUtxo) throw new Error(`No se encontró predecesor para slot ${datum.slotId}`)

      // Find the fresh slot UTxO
      const freshSlotUtxo = allUtxos.find(u =>
        u.txHash === slot.txHash && u.outputIndex === slot.outputIndex
      )
      if (!freshSlotUtxo) throw new Error('Slot UTxO no encontrado en la cadena')

      // Predecessor continues with slot's next
      const slotNextConstr = nodeKeyConstr(datum.next)
      const newPredDatum   = rebuildPredDatum(predRawDatum, slotNextConstr)

      // Redeemers
      const removePrevRedeemer = Data.to(new Constr(8, [slotNextConstr]))       // RemovePrev { new_next }
      const cancelRedeemer     = Data.to(new Constr(1, []))                     // CancelRent
      const mintRedeemer       = Data.to(new Constr(1, [customerPkh]))          // BurnRentNFT

      // ValidTo: must be ≤ cancelDeadline
      const validToMs = Math.min(Date.now() + 10 * 60_000, datum.cancelDeadline - 1)

      let txBuilder = lucid.newTx()
        // Spend predecessor with RemovePrev
        .collectFrom([predUtxo], removePrevRedeemer)
        // Spend slot with CancelRent
        .collectFrom([freshSlotUtxo], cancelRedeemer)
        .attach.SpendingValidator({ type: 'PlutusV3', script: appliedRentSpend })
        // Predecessor continues with updated next
        .pay.ToContract(
          RENT_VALIDATOR_ADDR,
          { kind: 'inline', value: newPredDatum },
          { lovelace: predUtxo.assets.lovelace },
        )
        // Refund rentPrice to customer
        .pay.ToAddress(customerAddr, { lovelace: datum.rentPrice })
        .addSignerKey(customerPkh)
        .validTo(validToMs)

      // Only burn NFT if slot has a Rent NFT (Confirmed status)
      if (datum.rentNFTName) {
        const tokenUnit = RENT_NFT_POLICY + datum.rentNFTName
        txBuilder = txBuilder
          .mintAssets({ [tokenUnit]: -1n }, mintRedeemer)
          .attach.MintingPolicy({ type: 'PlutusV3', script: appliedRentMint })
      }

      const tx     = await txBuilder.complete()
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

  return { cancel, loading, error }
}
