// Tx: ResolveToOwner — company resolves a Disputed slot in the owner's favor.
// Slot stays in the list as Completed (next preserved); dispute deposit goes
// to the company; Rent NFT is burned; owner's stats UTxO rentals_completed++
// (so CollectPayments doesn't double-release the guarantee for this slot).

import { useState } from 'react'
import { Data, Constr } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  RENT_VALIDATOR_ADDR,
  OWNERS_VALIDATOR_ADDR,
  OWNER_NFT_POLICY,
  RENT_NFT_POLICY,
  COMPANY_PKH,
  COMPANY_ADDR,
} from '../lib/config'
import { getAddressUtxos } from '../lib/blockfrost'
import { decodeOwnersDatum } from '../lib/decoders'
import { getRentSpendRefUtxo, getOwnersSpendRefUtxo, getRentMintRefUtxo } from '../lib/refScripts'
import {
  findCustomerRecordUtxo, initialCustomerRecordDatum, bumpedCustomerRecordDatum,
  updateCustomerRecordRedeemer, CUSTOMER_RECORD_MIN_LOVELACE,
} from '../lib/customerRecord'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'
import type { RentSlotUtxo } from './useRentSlots'

export function useResolveToOwner() {
  const { lucid, pkh: companyPkh } = useLucid()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const resolveToOwner = async (slot: RentSlotUtxo): Promise<string> => {
    if (!lucid) throw new Error('Wallet no conectada')
    if (companyPkh !== COMPANY_PKH) throw new Error('Solo la wallet de la company puede resolver disputas')
    const datum = slot.datum
    if (datum.status !== 'Disputed') throw new Error('Solo se puede resolver un slot Disputed')
    if (!datum.customerPkh || !datum.rentNFTName || datum.disputeDeposit === null)
      throw new Error('Datum de disputa incompleto')

    setLoading(true)
    setError(null)

    try {
      const rentNftUnit = RENT_NFT_POLICY + datum.rentNFTName
      const fieldNftUnit = OWNER_NFT_POLICY + datum.ownerNFTName

      const allRentUtxos = await lucid.utxosAt(RENT_VALIDATOR_ADDR)
      const freshSlotUtxo = allRentUtxos.find(u =>
        u.txHash === slot.txHash && u.outputIndex === slot.outputIndex
      )
      if (!freshSlotUtxo) throw new Error('Slot UTxO no encontrado en la cadena')

      const ownersUtxos = await getAddressUtxos(OWNERS_VALIDATOR_ADDR)
      const ownerStatsRaw = ownersUtxos.find(u => {
        if (!u.inline_datum) return false
        if (u.amount.some(a => a.unit === fieldNftUnit)) return false
        try {
          const d = decodeOwnersDatum(u.inline_datum)
          return d.kind === 'Owner' && d.record.ownerNFTName === datum.ownerNFTName
        } catch { return false }
      })
      if (!ownerStatsRaw) throw new Error('Stats UTxO del propietario no encontrado')
      const ownerRecord = decodeOwnersDatum(ownerStatsRaw.inline_datum!)
      if (ownerRecord.kind !== 'Owner') throw new Error('Datum inesperado')
      const statsLovelace = BigInt(ownerStatsRaw.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0')

      // rentals_completed + 1 — preserve all other 16 fields generically
      const rawOwnerDatum = Data.from(ownerStatsRaw.inline_datum!) as Constr<Data>
      const innerRecord = rawOwnerDatum.fields[0] as Constr<Data>
      const newRecordFields = [...innerRecord.fields]
      newRecordFields[2] = BigInt(ownerRecord.record.rentalsCompleted) + 1n
      const newStatsDatum = Data.to(new Constr(1, [new Constr(0, newRecordFields)]))

      // Continuing slot datum — Completed, next preserved, rent_nft_name/dispute_deposit cleared
      const nextField = datum.next.tag === 'Empty' ? new Constr(1, []) : new Constr(0, [BigInt(datum.next.key)])
      const newSlotDatum = Data.to(new Constr(1, [new Constr(0, [
        BigInt(datum.slotId), BigInt(datum.slotStart), BigInt(datum.slotEnd), BigInt(datum.cancelDeadline),
        datum.rentPrice, BigInt(datum.siteCommissionBps),
        datum.ownerNFTName, datum.ownerPkh, datum.companyPkh,
        new Constr(3, []),                  // status = Completed
        new Constr(0, [datum.customerPkh]), // customer_pkh preserved
        new Constr(1, []),                  // rent_nft_name = None (burned)
        new Constr(1, []),                  // dispute_deposit = None
        datum.fieldName, datum.fieldAddress, datum.phone, datum.email, datum.lat, datum.long, datum.paymentAddress,
        nextField,
        BigInt(datum.weekEnd),
        BigInt(datum.loyaltyNftsRequired),
        datum.guaranteePerSlot,  // M3
      ])]))

      const spendRedeemer = Data.to(new Constr(6, []))                // ResolveToOwner (rent_spend)
      const statsRedeemer = Data.to(new Constr(4, []))                // ResolveToOwner (owners_spend)
      const mintRedeemer  = Data.to(new Constr(1, [companyPkh]))      // BurnRentNFT

      const [rentSpendRefUtxo, ownersSpendRefUtxo, rentMintRefUtxo] = await Promise.all([
        getRentSpendRefUtxo(lucid), getOwnersSpendRefUtxo(lucid), getRentMintRefUtxo(lucid),
      ])

      // CustomerRecord (per cancha) — bump disputes_lost for the customer who
      // lost this dispute. No redeemer/auth needed to create the first one.
      const existingCustomerRecord = await findCustomerRecordUtxo(datum.customerPkh, datum.ownerNFTName)

      let txBuilder = lucid.newTx()
        .readFrom([rentSpendRefUtxo, ownersSpendRefUtxo, rentMintRefUtxo])
        .collectFrom([freshSlotUtxo], spendRedeemer)
        .collectFrom(
          [{
            txHash: ownerStatsRaw.tx_hash,
            outputIndex: ownerStatsRaw.output_index,
            address: OWNERS_VALIDATOR_ADDR,
            assets: { lovelace: statsLovelace },
            datum: ownerStatsRaw.inline_datum!,
          }],
          statsRedeemer,
        )
        .mintAssets({ [rentNftUnit]: -1n }, mintRedeemer)
        .pay.ToContract(RENT_VALIDATOR_ADDR, { kind: 'inline', value: newSlotDatum }, { lovelace: datum.rentPrice })
        .pay.ToAddress(COMPANY_ADDR, { lovelace: datum.disputeDeposit })
        .pay.ToContract(OWNERS_VALIDATOR_ADDR, { kind: 'inline', value: newStatsDatum }, { lovelace: statsLovelace })
        .addSignerKey(companyPkh)

      if (existingCustomerRecord) {
        txBuilder = txBuilder
          .collectFrom(
            [{ txHash: existingCustomerRecord.tx_hash, outputIndex: existingCustomerRecord.output_index,
               address: OWNERS_VALIDATOR_ADDR,
               assets: { lovelace: BigInt(existingCustomerRecord.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0') },
               datum: existingCustomerRecord.inline_datum! }],
            updateCustomerRecordRedeemer('DisputeLost'),
          )
          .pay.ToContract(
            OWNERS_VALIDATOR_ADDR,
            { kind: 'inline', value: bumpedCustomerRecordDatum(existingCustomerRecord.inline_datum!, 'DisputeLost') },
            { lovelace: BigInt(existingCustomerRecord.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0') },
          )
      } else {
        txBuilder = txBuilder.pay.ToContract(
          OWNERS_VALIDATOR_ADDR,
          { kind: 'inline', value: initialCustomerRecordDatum(datum.customerPkh, datum.ownerNFTName, 'DisputeLost') },
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

  return { resolveToOwner, loading, error }
}
