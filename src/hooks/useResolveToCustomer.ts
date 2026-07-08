// Tx: ResolveToCustomer — company resolves a Disputed slot in the customer's
// favor. Slot is removed from the list; customer gets rent_price + dispute
// deposit back; Rent NFT is burned; owner's stats UTxO is debited.
//
// Mirrors resolve-to-customer.mjs exactly, including the known Mejora I
// design issue: the on-chain check currently requires deducting
// `dispute_fee + guarantee_per_slot` from the owner's stats UTxO (not just
// guarantee_per_slot, even though dispute_fee is already covered by the
// slot's own deposit) — see CLAUDE.md "Issue conocido — Mejora I". This must
// match whatever check_resolve_to_customer_owners currently enforces, or the
// tx fails on-chain; fixing the double-deduction needs an on-chain change.

import { useState } from 'react'
import { Data, Constr, credentialToAddress } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  RENT_VALIDATOR_ADDR,
  OWNERS_VALIDATOR_ADDR,
  RENT_NFT_POLICY,
  OWNER_NFT_POLICY,
  COMPANY_PKH,
} from '../lib/config'
import { getAddressUtxos } from '../lib/blockfrost'
import { decodeOwnersDatum, decodeRentDatum, decodeListHeadDatum } from '../lib/decoders'
import { getRentSpendRefUtxo, getOwnersSpendRefUtxo, getRentMintRefUtxo } from '../lib/refScripts'
import {
  findCustomerRecordUtxo, initialCustomerRecordDatum, bumpedCustomerRecordDatum,
  updateCustomerRecordRedeemer, CUSTOMER_RECORD_MIN_LOVELACE,
} from '../lib/customerRecord'
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

export function useResolveToCustomer() {
  const { lucid, pkh: companyPkh } = useLucid()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const resolveToCustomer = async (slot: RentSlotUtxo): Promise<string> => {
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

      // Find predecessor (UTxO whose next = Key(slot.slotId)), scoped to this owner's THIS
      // week (ownerNFTName + weekEnd) — an owner can have multiple concurrent weeks (M3)
      // and slot IDs repeat across weeks, so matching only on "next == Key(slotId)" can
      // pick a predecessor from an unrelated week.
      const allRentUtxos = await lucid.utxosAt(RENT_VALIDATOR_ADDR)
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

      // ── Owner stats UTxO ──
      const fieldNftUnit = OWNER_NFT_POLICY + datum.ownerNFTName
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
      const rec = ownerRecord.record
      const statsLovelace = BigInt(ownerStatsRaw.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0')

      // ── CompanyConfig reference — read dispute_fee ──
      const companyConfigRaw = ownersUtxos.find(u => {
        if (!u.inline_datum) return false
        try { return decodeOwnersDatum(u.inline_datum).kind === 'Company' } catch { return false }
      })
      if (!companyConfigRaw) throw new Error('CompanyConfig no encontrado')
      const companyConfig = decodeOwnersDatum(companyConfigRaw.inline_datum!)
      if (companyConfig.kind !== 'Company') throw new Error('Datum inesperado')
      const disputeFee = companyConfig.config.disputeFee

      // Fix I: deducción EXACTA con clamp — si el pozo no cubre fee+gps se deduce
      // lo disponible dejando el min-UTxO del stats (2₳).
      const min2n     = (a: bigint, b: bigint) => a <= b ? a : b
      const available = statsLovelace - 2_000_000n
      const deduction = min2n(disputeFee + datum.guaranteePerSlot, available > 0n ? available : 0n)
      const statsContinuing = statsLovelace - deduction

      // rentals_disputed + 1 — preserve all other 18 fields generically
      const rawOwnerDatum = Data.from(ownerStatsRaw.inline_datum!) as Constr<Data>
      const innerRecord = rawOwnerDatum.fields[0] as Constr<Data>
      const newRecordFields = [...innerRecord.fields]
      newRecordFields[4] = BigInt(rec.rentalsDisputed) + 1n
      // P: la entry de la semana del slot disputado baja min(gps, entry)
      const weekEndKey  = BigInt(datum.weekEnd)
      const lockedWeeks = (innerRecord.fields[16] ?? new Map()) as Map<bigint, bigint>
      const lockedEntry = lockedWeeks.get(weekEndKey) ?? 0n
      const entryCut    = min2n(datum.guaranteePerSlot, lockedEntry)
      newRecordFields[16] = new Map(
        [...lockedWeeks].map(([k, v]) => k === weekEndKey ? [k, v - entryCut] as [bigint, bigint] : [k, v] as [bigint, bigint])
      )
      const newStatsDatum = Data.to(new Constr(1, [new Constr(0, newRecordFields)]))

      const newPredDatum = rebuildPredDatum(predRawDatum, nodeKeyConstr(datum.next))

      const removePrevRedeemer = Data.to(new Constr(8, [nodeKeyConstr(datum.next)]))  // RemovePrev
      const spendRedeemer      = Data.to(new Constr(5, []))                           // ResolveToCustomer (rent_spend)
      const statsRedeemer      = Data.to(new Constr(3, []))                           // ResolveToCustomer (owners_spend)
      const mintRedeemer       = Data.to(new Constr(1, [companyPkh]))                 // BurnRentNFT

      const customerEnterpriseAddr = credentialToAddress('Preview', { type: 'Key', hash: datum.customerPkh })

      const [rentSpendRefUtxo, ownersSpendRefUtxo, rentMintRefUtxo] = await Promise.all([
        getRentSpendRefUtxo(lucid), getOwnersSpendRefUtxo(lucid), getRentMintRefUtxo(lucid),
      ])

      // CustomerRecord (per cancha) — bump disputes_won for the customer who
      // won this dispute. No redeemer/auth needed to create the first one.
      const existingCustomerRecord = await findCustomerRecordUtxo(datum.customerPkh, datum.ownerNFTName)

      let txBuilder = lucid.newTx()
        .readFrom([rentSpendRefUtxo, ownersSpendRefUtxo, rentMintRefUtxo])
        .readFrom([{
          txHash: companyConfigRaw.tx_hash,
          outputIndex: companyConfigRaw.output_index,
          address: OWNERS_VALIDATOR_ADDR,
          assets: Object.fromEntries(companyConfigRaw.amount.map(a => [a.unit, BigInt(a.quantity)])),
          datum: companyConfigRaw.inline_datum!,
        }])
        .collectFrom([predUtxo], removePrevRedeemer)
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
        .pay.ToContract(RENT_VALIDATOR_ADDR, { kind: 'inline', value: newPredDatum }, predUtxo.assets)
        .pay.ToAddress(customerEnterpriseAddr, { lovelace: datum.rentPrice + datum.disputeDeposit })
        .pay.ToContract(OWNERS_VALIDATOR_ADDR, { kind: 'inline', value: newStatsDatum }, { lovelace: statsContinuing })
        .pay.ToAddress(await lucid.wallet().address(), { lovelace: deduction })
        .addSignerKey(companyPkh)

      if (existingCustomerRecord) {
        txBuilder = txBuilder
          .collectFrom(
            [{ txHash: existingCustomerRecord.tx_hash, outputIndex: existingCustomerRecord.output_index,
               address: OWNERS_VALIDATOR_ADDR,
               assets: { lovelace: BigInt(existingCustomerRecord.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0') },
               datum: existingCustomerRecord.inline_datum! }],
            updateCustomerRecordRedeemer('DisputeWon'),
          )
          .pay.ToContract(
            OWNERS_VALIDATOR_ADDR,
            { kind: 'inline', value: bumpedCustomerRecordDatum(existingCustomerRecord.inline_datum!, 'DisputeWon') },
            { lovelace: BigInt(existingCustomerRecord.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0') },
          )
      } else {
        txBuilder = txBuilder.pay.ToContract(
          OWNERS_VALIDATOR_ADDR,
          { kind: 'inline', value: initialCustomerRecordDatum(datum.customerPkh, datum.ownerNFTName, 'DisputeWon') },
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

  return { resolveToCustomer, loading, error }
}
