// Tx: RedeemAtField — transfers Rent NFT to customer wallet (loyalty), Confirmed → Completed.
// next field preserved.

import { useState } from 'react'
import { Data, Constr } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import { RENT_VALIDATOR_ADDR, OWNERS_VALIDATOR_ADDR, RENT_NFT_POLICY } from '../lib/config'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'
import { getRentSpendRefUtxo, getOwnersSpendRefUtxo } from '../lib/refScripts'
import {
  findCustomerRecordUtxo, initialCustomerRecordDatum, bumpedCustomerRecordDatum,
  updateCustomerRecordRedeemer, CUSTOMER_RECORD_MIN_LOVELACE,
} from '../lib/customerRecord'
import type { RentSlotUtxo } from './useRentSlots'
import type { NodeKey } from '../components/types'

function nodeKeyConstr(nk: NodeKey): Constr<Data> {
  return nk.tag === 'Empty' ? new Constr(1, []) : new Constr(0, [BigInt(nk.key)])
}

export function useRedeemAtField() {
  const { lucid, pkh: customerPkh } = useLucid()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const redeemAtField = async (slot: RentSlotUtxo): Promise<string> => {
    if (!lucid) throw new Error('Wallet no conectada')

    setLoading(true)
    setError(null)

    try {
      const datum = slot.datum
      if (!datum.rentNFTName) throw new Error('datum.rentNFTName is null — slot not confirmed')
      const tokenUnit   = RENT_NFT_POLICY + datum.rentNFTName
      const customerAddr = await lucid.wallet().address()

      // RedeemAtField = Constr 3 []
      const spendRedeemer = Data.to(new Constr(3, []))

      // Completed datum — next preserved
      const completedDatum = Data.to(new Constr(1, [new Constr(0, [
        BigInt(datum.slotId),
        BigInt(datum.slotStart),
        BigInt(datum.slotEnd),
        BigInt(datum.cancelDeadline),
        datum.rentPrice,
        BigInt(datum.siteCommissionBps),
        datum.ownerNFTName,
        datum.ownerPkh,
        datum.companyPkh,
        new Constr(3, []),                        // Completed
        new Constr(0, [datum.customerPkh!]),      // Some(customerPkh)
        new Constr(1, []),                        // rentNFTName = None
        new Constr(1, []),                        // disputeDeposit = None
        datum.fieldName,
        datum.fieldAddress,
        datum.phone,
        datum.email,
        datum.lat,
        datum.long,
        datum.paymentAddress,
        nodeKeyConstr(datum.next),                // next preserved
        BigInt(datum.weekEnd),                    // week_end
        BigInt(datum.loyaltyNftsRequired),        // loyalty_nfts_required
        datum.guaranteePerSlot,                    // guarantee_per_slot — M3
      ])]))

      // Window: opens slot_start-15min, closes at week_end (improvement A).
      // after()/before() are open intervals — stay strictly inside the bounds.
      const validFromMs = datum.slotStart - 15 * 60_000 + 1000
      const validToMs   = Math.min(Date.now() + 10 * 60_000, datum.weekEnd - 1000)

      // CustomerRecord (per cancha) — bump rentals_completed. No redeemer/auth
      // needed to create the first one (see lib/customerRecord.ts).
      const existingRecord = await findCustomerRecordUtxo(customerPkh, datum.ownerNFTName)

      const [rentSpendRefUtxo, ownersSpendRefUtxo] = await Promise.all([
        getRentSpendRefUtxo(lucid), getOwnersSpendRefUtxo(lucid),
      ])

      let txBuilder = lucid.newTx()
        .readFrom([rentSpendRefUtxo, ownersSpendRefUtxo])
        .collectFrom(
          [{ txHash: slot.txHash, outputIndex: slot.outputIndex, address: slot.address,
             assets: { lovelace: slot.lovelace, [tokenUnit]: 1n }, datum: slot.rawDatum }],
          spendRedeemer,
        )
        // CIP-25 metadata (721) is attached at mint time — see useReserveSlot.ts /
        // useConfirmRent.ts. This tx only transfers an already-minted token, so
        // metadata here wouldn't be indexed by wallets.
        // NFT transferred to customer wallet as loyalty token (not burned)
        .pay.ToAddress(customerAddr, { lovelace: 2_000_000n, [tokenUnit]: 1n })
        .pay.ToContract(
          RENT_VALIDATOR_ADDR,
          { kind: 'inline', value: completedDatum },
          { lovelace: slot.lovelace },
        )
        .addSignerKey(customerPkh)
        .validFrom(validFromMs)
        .validTo(validToMs)

      if (existingRecord) {
        txBuilder = txBuilder
          .collectFrom(
            [{ txHash: existingRecord.tx_hash, outputIndex: existingRecord.output_index,
               address: OWNERS_VALIDATOR_ADDR,
               assets: { lovelace: BigInt(existingRecord.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0') },
               datum: existingRecord.inline_datum! }],
            updateCustomerRecordRedeemer('RentalCompleted'),
          )
          .pay.ToContract(
            OWNERS_VALIDATOR_ADDR,
            { kind: 'inline', value: bumpedCustomerRecordDatum(existingRecord.inline_datum!, 'RentalCompleted') },
            { lovelace: BigInt(existingRecord.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0') },
          )
      } else {
        txBuilder = txBuilder.pay.ToContract(
          OWNERS_VALIDATOR_ADDR,
          { kind: 'inline', value: initialCustomerRecordDatum(customerPkh, datum.ownerNFTName, 'RentalCompleted') },
          { lovelace: CUSTOMER_RECORD_MIN_LOVELACE },
        )
      }

      const tx = await txBuilder.complete()

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

  return { redeemAtField, loading, error }
}
