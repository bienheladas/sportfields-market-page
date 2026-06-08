// Tx: CollectSlot (REMOVE) — owner removes Completed slot node + collects rent.
// Spends predecessor (RemovePrev) + slot (CollectSlot) + Owner NFT (CollectPayments).
// Commission to company. rentals_completed++.

import { useState } from 'react'
import { Data, Constr, applyParamsToScript } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  OWNERS_VALIDATOR_ADDR,
  RENT_VALIDATOR_ADDR,
  RENT_VALIDATOR_HASH,
  RENT_NFT_POLICY,
  OWNER_NFT_POLICY,
  COMPANY_PKH,
  COMPANY_ADDR,
  OWNERS_SPEND_COMPILED,
  RENT_SPEND_COMPILED,
} from '../lib/config'
import { getAddressUtxos } from '../lib/blockfrost'
import { decodeOwnersDatum, decodeRentDatum } from '../lib/decoders'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'
import type { RentSlotUtxo } from './useRentSlots'
import type { NodeKey } from '../components/types'

const appliedOwnersSpend = applyParamsToScript(OWNERS_SPEND_COMPILED, [
  new Constr(0, [COMPANY_PKH, OWNER_NFT_POLICY, RENT_VALIDATOR_HASH])
])
const appliedRentSpend = applyParamsToScript(RENT_SPEND_COMPILED, [
  new Constr(0, [OWNER_NFT_POLICY, RENT_NFT_POLICY])
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

export function useCollectSlot() {
  const { lucid, pkh: ownerPkh } = useLucid()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const collectSlot = async (slot: RentSlotUtxo): Promise<string> => {
    if (!lucid) throw new Error('Wallet no conectada')
    if (slot.datum.status !== 'Completed') throw new Error('Solo se puede cobrar un slot Completed')

    setLoading(true)
    setError(null)

    try {
      const datum = slot.datum

      // Find predecessor (UTxO whose next = Key(slot.slotId))
      const allRentUtxos = await lucid.utxosAt(RENT_VALIDATOR_ADDR)

      let predUtxo: typeof allRentUtxos[0] | null = null
      let predRawDatum = ''
      for (const u of allRentUtxos) {
        if (!u.datum) continue
        if (u.txHash === slot.txHash && u.outputIndex === slot.outputIndex) continue
        try {
          const d = decodeRentDatum(u.datum)
          if (d && d.next.tag === 'Key' && d.next.key === datum.slotId) {
            predUtxo = u; predRawDatum = u.datum; break
          }
        } catch { /* skip */ }
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

      const freshSlotUtxo = allRentUtxos.find(u =>
        u.txHash === slot.txHash && u.outputIndex === slot.outputIndex
      )
      if (!freshSlotUtxo) throw new Error('Slot UTxO no encontrado en la cadena')

      // G: stats UTxO has no NFT; NFT lives in owner's wallet
      // Use slot datum's ownerNFTName to identify the correct field (supports multi-field)
      const fieldNftName = datum.ownerNFTName
      const fieldNftUnit = OWNER_NFT_POLICY + fieldNftName
      const ownerUtxos = await getAddressUtxos(OWNERS_VALIDATOR_ADDR)
      const ownerStatsRaw = ownerUtxos.find(u => {
        if (!u.inline_datum) return false
        if (u.amount.some(a => a.unit === fieldNftUnit)) return false
        try {
          const d = decodeOwnersDatum(u.inline_datum)
          return d.kind === 'Owner' && d.record.ownerNFTName === fieldNftName
        } catch { return false }
      })
      if (!ownerStatsRaw) throw new Error('Stats UTxO del propietario no encontrado en el contrato')

      // G: find this field's NFT in owner's wallet
      const walletAddr = await lucid.wallet().address()
      const walletUtxos = await lucid.utxosAt(walletAddr)
      const nftWalletUtxo = walletUtxos.find(u => (u.assets[fieldNftUnit] ?? 0n) >= 1n)
      if (!nftWalletUtxo) throw new Error('Owner NFT no encontrado en tu wallet')

      const ownerRecord = decodeOwnersDatum(ownerStatsRaw.inline_datum!)
      if (ownerRecord.kind !== 'Owner') throw new Error('Datum inesperado — no es OwnerRecord')
      const ownerLovelace = BigInt(ownerStatsRaw.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0')

      // Updated OwnerRecord: rentals_completed + 1
      const rec = ownerRecord.record
      const updatedOwnerRecord = new Constr(0, [
        rec.ownerNFTName, rec.ownerPkh,
        BigInt(rec.rentalsCompleted) + 1n,
        BigInt(rec.rentalsRefunded),
        BigInt(rec.rentalsDisputed),
        BigInt(rec.rentNFTsProven),
        rec.fieldName, rec.address, rec.phone, rec.email, rec.lat, rec.long, rec.paymentAddress,
        rec.guaranteePerSlot,  // field 13 — must be preserved
      ])
      const updatedOwnerDatum = Data.to(new Constr(1, [updatedOwnerRecord]))

      // Commission
      const commission = datum.rentPrice * BigInt(datum.siteCommissionBps) / 10000n

      // Predecessor continues with slot's next
      const newPredDatum = rebuildPredDatum(predRawDatum, nodeKeyConstr(datum.next))

      // Redeemers
      const removePrevRedeemer  = Data.to(new Constr(8, [nodeKeyConstr(datum.next)]))  // RemovePrev
      const collectRedeemer     = Data.to(new Constr(4, []))                           // CollectSlot
      const ownersRedeemer      = Data.to(new Constr(1, []))                           // CollectPayments

      const companyAddr = COMPANY_ADDR

      const tx = await lucid.newTx()
        .collectFrom([predUtxo], removePrevRedeemer)
        .collectFrom([freshSlotUtxo], collectRedeemer)
        .attach.SpendingValidator({ type: 'PlutusV3', script: appliedRentSpend })
        .collectFrom(
          [{
            txHash: ownerStatsRaw.tx_hash,
            outputIndex: ownerStatsRaw.output_index,
            address: OWNERS_VALIDATOR_ADDR,
            assets: { lovelace: ownerLovelace },  // G: no NFT in stats UTxO
            datum: ownerStatsRaw.inline_datum!,
          }],
          ownersRedeemer,
        )
        .attach.SpendingValidator({ type: 'PlutusV3', script: appliedOwnersSpend })
        .pay.ToContract(
          RENT_VALIDATOR_ADDR,
          { kind: 'inline', value: newPredDatum },
          { lovelace: predUtxo.assets.lovelace },
        )
        .pay.ToContract(
          OWNERS_VALIDATOR_ADDR,
          { kind: 'inline', value: updatedOwnerDatum },
          { lovelace: ownerLovelace - rec.guaranteePerSlot },  // release 1 slot's guarantee
        )
        // G: NFT pass-through — return to wallet (proves NFT ownership on-chain)
        .pay.ToAddress(walletAddr, { lovelace: nftWalletUtxo.assets.lovelace, [fieldNftUnit]: 1n })
        .pay.ToAddress(companyAddr, { lovelace: commission })
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
