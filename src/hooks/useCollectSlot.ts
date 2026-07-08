// Tx: CollectSlot (REMOVE) — owner removes Completed slot node + collects rent.
// Spends predecessor (RemovePrev) + slot (CollectSlot) + Owner NFT (CollectPayments).
// Commission to company. rentals_completed++.

import { useState } from 'react'
import { Data, Constr } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  OWNERS_VALIDATOR_ADDR,
  RENT_VALIDATOR_ADDR,
  OWNER_NFT_POLICY,
  COMPANY_ADDR,
  MIN_COMMISSION_LOVELACE,
} from '../lib/config'
import { getAddressUtxos } from '../lib/blockfrost'
import { decodeOwnersDatum, decodeRentDatum, decodeListHeadDatum } from '../lib/decoders'
import { getRentSpendRefUtxo, getOwnersSpendRefUtxo } from '../lib/refScripts'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'
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

      // Scoped to this owner's THIS week (ownerNFTName + weekEnd) — an owner can have
      // multiple concurrent weeks (M3) and slot IDs repeat across weeks, so matching
      // only on "next == Key(slotId)" can pick a predecessor from an unrelated week.
      let predUtxo: typeof allRentUtxos[0] | null = null
      let predRawDatum = ''
      for (const u of allRentUtxos) {
        if (!u.datum) continue
        if (u.txHash === slot.txHash && u.outputIndex === slot.outputIndex) continue
        try {
          const d = decodeRentDatum(u.datum)
          if (d && d.ownerNFTName === datum.ownerNFTName && d.weekEnd === datum.weekEnd &&
              d.next.tag === 'Key' && d.next.key === datum.slotId) {
            predUtxo = u; predRawDatum = u.datum; break
          }
          if (d) continue
        } catch { /* skip */ }
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
      const walletUtxos = await lucid.wallet().getUtxos()
      const nftWalletUtxo = walletUtxos.find(u => (u.assets[fieldNftUnit] ?? 0n) >= 1n)
      if (!nftWalletUtxo) throw new Error('Owner NFT no encontrado en tu wallet')

      const ownerRecord = decodeOwnersDatum(ownerStatsRaw.inline_datum!)
      if (ownerRecord.kind !== 'Owner') throw new Error('Datum inesperado — no es OwnerRecord')
      const ownerLovelace = BigInt(ownerStatsRaw.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0')
      const rec = ownerRecord.record

      // Updated OwnerRecord: rentals_completed + 1 — preserve all 18 fields generically.
      const rawOwnerDatum = Data.from(ownerStatsRaw.inline_datum!) as Constr<Data>
      const innerRecord = rawOwnerDatum.fields[0] as Constr<Data>
      const newRecordFields = [...innerRecord.fields]
      newRecordFields[2] = BigInt(rec.rentalsCompleted) + 1n

      // P: liberación exacta contra la entry de la semana (locked_weeks, campo 16)
      const weekEndKey  = BigInt(datum.weekEnd)
      const min2n       = (a: bigint, b: bigint) => a <= b ? a : b
      const lockedWeeks = (innerRecord.fields[16] ?? new Map()) as Map<bigint, bigint>
      const uncommWeeks = (innerRecord.fields[17] ?? new Map()) as Map<bigint, bigint>
      const lockedEntry = lockedWeeks.get(weekEndKey) ?? 0n
      const release     = min2n(min2n(datum.guaranteePerSlot, lockedEntry), ownerLovelace - 2_000_000n)
      const mapSet = (m: Map<bigint, bigint>, k: bigint, v: bigint) =>
        new Map([...m].map(([kk, vv]) => kk === k ? [kk, v] as [bigint, bigint] : [kk, vv] as [bigint, bigint]))
      newRecordFields[16] = mapSet(lockedWeeks, weekEndKey, lockedEntry - release)

      // V: comisión sobre el acumulado semanal con carry (uncommissioned_weeks, campo 17)
      const carry             = (uncommWeeks.get(weekEndKey) ?? 0n) + datum.rentPrice
      const commissionDue     = carry * BigInt(datum.siteCommissionBps) / 10000n
      const commissionPayable = commissionDue >= MIN_COMMISSION_LOVELACE
      newRecordFields[17] = mapSet(uncommWeeks, weekEndKey, commissionPayable ? 0n : carry)

      const updatedOwnerDatum = Data.to(new Constr(1, [new Constr(0, newRecordFields)]))

      const nowMs = Date.now()
      if (nowMs <= datum.weekEnd)
        throw new Error(`Solo se puede cobrar después de week_end (${new Date(datum.weekEnd).toISOString()})`)

      // Predecessor continues with slot's next — preserve its FULL value, not just lovelace
      // (a predecessor that's itself a Confirmed slot may be escrowing its own Rent NFT).
      const newPredDatum = rebuildPredDatum(predRawDatum, nodeKeyConstr(datum.next))

      // Redeemers
      const removePrevRedeemer  = Data.to(new Constr(8, [nodeKeyConstr(datum.next)]))  // RemovePrev
      const collectRedeemer     = Data.to(new Constr(4, []))                           // CollectSlot
      const ownersRedeemer      = Data.to(new Constr(1, []))                           // CollectPayments

      // rent_spend (9.4 KB) + owners_spend (5.5 KB) inline exceed the 16.384 B tx
      // limit — read both from their deployed reference script UTxOs instead.
      const [rentSpendRefUtxo, ownersSpendRefUtxo] = await Promise.all([
        getRentSpendRefUtxo(lucid),
        getOwnersSpendRefUtxo(lucid),
      ])

      let txBuilder = lucid.newTx()
        .readFrom([rentSpendRefUtxo, ownersSpendRefUtxo])
        .collectFrom([predUtxo], removePrevRedeemer)
        .collectFrom([freshSlotUtxo], collectRedeemer)
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
        .pay.ToContract(
          RENT_VALIDATOR_ADDR,
          { kind: 'inline', value: newPredDatum },
          predUtxo.assets,
        )
        .pay.ToContract(
          OWNERS_VALIDATOR_ADDR,
          { kind: 'inline', value: updatedOwnerDatum },
          // P: liberación exacta — el pozo baja exactamente lo liberado (clampeado)
          { lovelace: ownerLovelace - release },
        )
        // G: NFT pass-through — return to wallet (proves NFT ownership on-chain)
        .pay.ToAddress(walletAddr, { lovelace: nftWalletUtxo.assets.lovelace, [fieldNftUnit]: 1n })
        .addSignerKey(ownerPkh)
        .validFrom(datum.weekEnd + 1000)  // after() es abierto: estrictamente posterior a week_end

      // V: comisión semanal — se paga solo cuando el carry cruza el umbral
      if (commissionPayable) {
        txBuilder = txBuilder.pay.ToAddress(COMPANY_ADDR, { lovelace: commissionDue })
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

  return { collectSlot, loading, error }
}
