// Tx: RedeemAtField — transfers Rent NFT to customer wallet (loyalty), Confirmed → Completed.
// next field preserved.

import { useState } from 'react'
import { Data, Constr } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import { decodeRentDatum } from '../lib/decoders'
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
      // Re-resolver el slot on-chain al construir la tx — el TxIn de la UI puede estar
      // stale: cualquier InsertPrev posterior que use este slot como predecesor lo gasta
      // y lo recrea en otro UTxO, además de CAMBIARLE el campo `next`. Hay que usar el
      // UTxO Y el datum frescos (con el next viejo, el continuing output no validaría).
      const freshUtxo = (await lucid.utxosAt(RENT_VALIDATOR_ADDR)).find(u => {
        if (!u.datum) return false
        try {
          const d = decodeRentDatum(u.datum)
          return d !== null && d.ownerNFTName === slot.datum.ownerNFTName &&
            d.weekEnd === slot.datum.weekEnd && d.slotId === slot.datum.slotId
        } catch { return false }
      })
      if (!freshUtxo || !freshUtxo.datum)
        throw new Error('La reserva ya no está en la cadena (¿ya fue redimida o cancelada?). Actualiza la lista.')
      const datum = decodeRentDatum(freshUtxo.datum)!
      if (datum.status !== 'Confirmed')
        throw new Error(`La reserva cambió de estado (${datum.status}). Actualiza la lista.`)

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
        .collectFrom([freshUtxo], spendRedeemer)
        // CIP-25 metadata (721) is attached at mint time — see useReserveSlot.ts /
        // useConfirmRent.ts. This tx only transfers an already-minted token, so
        // metadata here wouldn't be indexed by wallets.
        // NFT transferred to customer wallet as loyalty token (not burned)
        .pay.ToAddress(customerAddr, { lovelace: 2_000_000n, [tokenUnit]: 1n })
        .pay.ToContract(
          RENT_VALIDATOR_ADDR,
          { kind: 'inline', value: completedDatum },
          { lovelace: freshUtxo.assets.lovelace },
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
