// Tx: CancelRent (REMOVE) — burns Rent NFT, removes slot node from linked list.
// Spends predecessor with RemovePrev { new_next: slot.next } + slot with CancelRent.
// Refunds rentPrice to customer. No continuing slot output.

import { useState } from 'react'
import { Data, Constr } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import { RENT_VALIDATOR_ADDR, OWNERS_VALIDATOR_ADDR, RENT_NFT_POLICY } from '../lib/config'
import { decodeRentDatum, decodeListHeadDatum } from '../lib/decoders'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'
import { getRentSpendRefUtxo, getOwnersSpendRefUtxo, getRentMintRefUtxo } from '../lib/refScripts'
import {
  findCustomerRecordUtxo, initialCustomerRecordDatum, bumpedCustomerRecordDatum,
  updateCustomerRecordRedeemer, CUSTOMER_RECORD_MIN_LOVELACE,
} from '../lib/customerRecord'
import type { RentSlotUtxo } from './useRentSlots'
import type { NodeKey } from '../components/types'

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

      // Find predecessor: UTxO whose next = Key(slot.slotId), scoped to this owner's THIS
      // week (ownerNFTName + weekEnd) — an owner can have multiple concurrent weeks (M3)
      // and slot IDs repeat across weeks, so matching only on "next == Key(slotId)" can
      // pick a predecessor from an unrelated week.
      let predUtxo: typeof allUtxos[0] | null = null
      let predRawDatum = ''
      for (const u of allUtxos) {
        if (!u.datum) continue
        if (u.txHash === slot.txHash && u.outputIndex === slot.outputIndex) continue
        try {
          // Try as Node
          const d = decodeRentDatum(u.datum)
          if (d && d.ownerNFTName === datum.ownerNFTName && d.weekEnd === datum.weekEnd &&
              d.next.tag === 'Key' && d.next.key === datum.slotId) {
            predUtxo = u; predRawDatum = u.datum; break
          }
          if (d) continue
        } catch { /* skip */ }
        // Try as Head
        try {
          const h = decodeListHeadDatum(u.datum)
          const headWeekEnd = h.config.weekStartPosix + 7 * 24 * 3_600_000
          if (h.ownerNFTName === datum.ownerNFTName && headWeekEnd === datum.weekEnd &&
              h.next.tag === 'Key' && h.next.key === datum.slotId) {
            predUtxo = u; predRawDatum = u.datum; break
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

      // CustomerRecord (per cancha) — bump rentals_cancelled. No redeemer/auth
      // needed to create the first one (see lib/customerRecord.ts).
      const existingRecord = await findCustomerRecordUtxo(customerPkh, datum.ownerNFTName)

      const [rentSpendRefUtxo, ownersSpendRefUtxo, rentMintRefUtxo] = await Promise.all([
        getRentSpendRefUtxo(lucid), getOwnersSpendRefUtxo(lucid), getRentMintRefUtxo(lucid),
      ])

      let txBuilder = lucid.newTx()
        .readFrom([rentSpendRefUtxo, ownersSpendRefUtxo])
        // Spend predecessor with RemovePrev
        .collectFrom([predUtxo], removePrevRedeemer)
        // Spend slot with CancelRent
        .collectFrom([freshSlotUtxo], cancelRedeemer)
        // Predecessor continues with updated next — preserve its FULL value, not just
        // lovelace (a predecessor that's itself a Confirmed slot may escrow its own NFT).
        .pay.ToContract(
          RENT_VALIDATOR_ADDR,
          { kind: 'inline', value: newPredDatum },
          predUtxo.assets,
        )
        // Refund rentPrice to customer
        .pay.ToAddress(customerAddr, { lovelace: datum.rentPrice })
        .addSignerKey(customerPkh)
        .validTo(validToMs)

      // Only burn NFT if slot has a Rent NFT (Confirmed status)
      if (datum.rentNFTName) {
        const tokenUnit = RENT_NFT_POLICY + datum.rentNFTName
        txBuilder = txBuilder
          .readFrom([rentMintRefUtxo])
          .mintAssets({ [tokenUnit]: -1n }, mintRedeemer)
      }

      if (existingRecord) {
        txBuilder = txBuilder
          .collectFrom(
            [{ txHash: existingRecord.tx_hash, outputIndex: existingRecord.output_index,
               address: OWNERS_VALIDATOR_ADDR,
               assets: { lovelace: BigInt(existingRecord.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0') },
               datum: existingRecord.inline_datum! }],
            updateCustomerRecordRedeemer('RentalCancelled'),
          )
          .pay.ToContract(
            OWNERS_VALIDATOR_ADDR,
            { kind: 'inline', value: bumpedCustomerRecordDatum(existingRecord.inline_datum!, 'RentalCancelled') },
            { lovelace: BigInt(existingRecord.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0') },
          )
      } else {
        txBuilder = txBuilder.pay.ToContract(
          OWNERS_VALIDATOR_ADDR,
          { kind: 'inline', value: initialCustomerRecordDatum(customerPkh, datum.ownerNFTName, 'RentalCancelled') },
          { lovelace: CUSTOMER_RECORD_MIN_LOVELACE },
        )
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
