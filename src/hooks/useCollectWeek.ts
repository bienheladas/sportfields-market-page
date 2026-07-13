// Tx: Cobro semanal (batch) — port de collect-slot.mjs. Recorre la linked list de
// la semana, detecta todos los "runs" de slots cobrables (Completed, Confirmed
// no-show, y Pending sin confirmar — todos solo tras week_end) y los cobra en
// UNA sola tx:
//   - RemovePrev por cada predecesor de run
//   - CollectSlot por cada Completed/Confirmed; ForceClosePending por cada Pending
//     (el owner recibe el depósito del 50%; check_force_close_pending exige
//     after(cancel_deadline), cubierto por validFrom = week_end + 1s)
//   - CollectPayments sobre el stats UTxO (rentals_completed += N, P/V accounting)
//     — la comisión V se calcula on-chain sobre el rent_price COMPLETO de todos
//     los nodos gastados, Pendings incluidos (sum_rent_node_price)
//   - Quema los Rent NFTs de los no-shows
//   - P: si el cobro vacía la lista (un run, pred = Head, newNext = Empty), QUEMA
//     el head — libera su min-ADA + el remanente completo de la garantía de la
//     semana y decrementa active_weeks_count (cierre de semana absorbido).

import { useState } from 'react'
import { Data, Constr } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  OWNERS_VALIDATOR_ADDR,
  RENT_VALIDATOR_ADDR,
  OWNER_NFT_POLICY,
  RENT_NFT_POLICY,
  COMPANY_ADDR,
  MIN_COMMISSION_LOVELACE,
} from '../lib/config'
import { getAddressUtxos } from '../lib/blockfrost'
import { decodeOwnersDatum } from '../lib/decoders'
import { getRentSpendRefUtxo, getOwnersSpendRefUtxo, getRentMintRefUtxo } from '../lib/refScripts'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'
import type { ListHeadUtxo } from './useRentSlots'

type SlotDatumParsed = { type: 'Head' | 'Node'; inner: Constr<Data> }

function parseSlotDatum(datumCbor: string): SlotDatumParsed | null {
  try {
    const d = Data.from(datumCbor)
    if (!(d instanceof Constr)) return null
    if (d.index === 0) return { type: 'Head', inner: d.fields[0] as Constr<Data> }
    if (d.index === 1) return { type: 'Node', inner: d.fields[0] as Constr<Data> }
    return null
  } catch { return null }
}

function getNext(sd: SlotDatumParsed): Constr<Data> {
  return (sd.type === 'Head' ? sd.inner.fields[11] : sd.inner.fields[20]) as Constr<Data>
}

function predDatumWithNext(sd: SlotDatumParsed, newNext: Constr<Data>): string {
  const f = sd.inner.fields
  if (sd.type === 'Head') {
    return Data.to(new Constr(0, [new Constr(0, [
      f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7], f[8], f[9], f[10], newNext,
    ])]))
  }
  return Data.to(new Constr(1, [new Constr(0, [
    f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7], f[8], f[9],
    f[10], f[11], f[12], f[13], f[14], f[15], f[16], f[17], f[18], f[19], newNext, f[21], f[22], f[23],
  ])]))
}

export interface CollectWeekPreview {
  collectableCount: number
  totalRent: bigint
  noShowCount: number
  closesWeek: boolean
}

export function useCollectWeek() {
  const { lucid, pkh: ownerPkh } = useLucid()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const collectWeek = async (headParam: ListHeadUtxo): Promise<string> => {
    if (!lucid || !ownerPkh) throw new Error('Wallet no conectada')
    setLoading(true)
    setError(null)

    try {
      const headDatum = headParam.datum
      const weekEndMs = headDatum.config.weekStartPosix + 7 * 24 * 3_600_000
      const nowMs = Date.now()
      if (nowMs <= weekEndMs)
        throw new Error(`Solo se puede cobrar después del fin de la semana (${new Date(weekEndMs).toISOString()})`)

      // ── Recorrer la lista de ESTA semana (fresh) ────────────────────────
      const allRentUtxos = await lucid.utxosAt(RENT_VALIDATOR_ADDR)

      type Entry = { utxo: typeof allRentUtxos[0]; sd: SlotDatumParsed }
      const nodeById = new Map<number, Entry>()
      let headEntry: Entry | null = null

      for (const u of allRentUtxos) {
        if (!u.datum) continue
        const sd = parseSlotDatum(u.datum)
        if (!sd) continue
        if (sd.type === 'Head') {
          if (u.txHash === headParam.txHash && u.outputIndex === headParam.outputIndex)
            headEntry = { utxo: u, sd }
        } else {
          // Node: scope by ownerNFTName + weekEnd (M3: slot IDs repiten entre semanas)
          if (sd.inner.fields[6] === headDatum.ownerNFTName &&
              Number(sd.inner.fields[21]) === weekEndMs)
            nodeById.set(Number(sd.inner.fields[0]), { utxo: u, sd })
        }
      }
      if (!headEntry) throw new Error('ListHead no encontrado en la cadena — recarga la página')

      // Runs de slots cobrables: Completed (3) o Confirmed no-show (2), tras week_end
      type Run = { predEntry: Entry; slots: Entry[]; newNext?: Constr<Data> }
      const runs: Run[] = []
      let cursor = getNext(headEntry.sd)
      let predEntry: Entry = headEntry
      let currentRun: Run | null = null

      while (cursor.index === 0) {
        const slotId = Number(cursor.fields[0])
        const entry = nodeById.get(slotId)
        if (!entry) break

        const statusIdx = (entry.sd.inner.fields[9] as Constr<Data>).index
        // Completed (3), Confirmed no-show (2), Pending sin confirmar (1)
        const isCollectable = statusIdx === 3 || statusIdx === 2 || statusIdx === 1

        if (isCollectable) {
          if (!currentRun) {
            currentRun = { predEntry, slots: [] }
            runs.push(currentRun)
          }
          currentRun.slots.push(entry)
        } else {
          if (currentRun) {
            currentRun.newNext = cursor
            currentRun = null
          }
          predEntry = entry
        }
        cursor = getNext(entry.sd)
      }
      if (currentRun) currentRun.newNext = cursor  // Empty

      if (runs.length === 0)
        throw new Error('No hay slots cobrables en esta semana (completados o no-shows)')

      const allSlotEntries = runs.flatMap(r => r.slots)
      const statusOf = (e: Entry) => (e.sd.inner.fields[9] as Constr<Data>).index
      const collectEntries = allSlotEntries.filter(e => statusOf(e) !== 1)  // Completed + Confirmed
      const pendingEntries = allSlotEntries.filter(e => statusOf(e) === 1)  // ForceClosePending

      // Al owner: rent completo por Completed/Confirmed + depósito 50% por Pending.
      // Para la comisión V el on-chain suma el rent_price COMPLETO de TODOS los
      // nodos gastados (sum_rent_node_price) — Pendings incluidos.
      const rentOf = (e: Entry) => e.sd.inner.fields[4] as bigint
      const totalToOwner =
        collectEntries.reduce((s, e) => s + rentOf(e), 0n) +
        pendingEntries.reduce((s, e) => s + rentOf(e) * 5000n / 10000n, 0n)
      const totalRent = allSlotEntries.reduce((s, e) => s + rentOf(e), 0n)
      const weekBps = allSlotEntries[0].sd.inner.fields[5] as bigint

      // P: ¿este cobro vacía la lista? → quemar el head (cierre de semana)
      const burnRun = runs.length === 1 &&
        runs[0].predEntry.sd.type === 'Head' &&
        runs[0].newNext!.index === 1
        ? runs[0] : null

      // ── Stats UTxO + Owner NFT ───────────────────────────────────────────
      const fieldNftUnit = OWNER_NFT_POLICY + headDatum.ownerNFTName
      const ownerUtxos = await getAddressUtxos(OWNERS_VALIDATOR_ADDR)
      const ownerStatsRaw = ownerUtxos.find(u => {
        if (!u.inline_datum) return false
        try {
          const d = decodeOwnersDatum(u.inline_datum)
          return d.kind === 'Owner' && d.record.ownerNFTName === headDatum.ownerNFTName
        } catch { return false }
      })
      if (!ownerStatsRaw) throw new Error('Stats UTxO del propietario no encontrado')

      const walletAddr = await lucid.wallet().address()
      const walletUtxos = await lucid.wallet().getUtxos()
      const nftWalletUtxo = walletUtxos.find(u => (u.assets[fieldNftUnit] ?? 0n) >= 1n)
      if (!nftWalletUtxo) throw new Error('Owner NFT no encontrado en tu wallet')

      const statsLovelace = BigInt(ownerStatsRaw.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0')
      const rawOwnerDatum = Data.from(ownerStatsRaw.inline_datum!) as Constr<Data>
      const innerRecord = rawOwnerDatum.fields[0] as Constr<Data>

      // M3: suma del guarantee_per_slot PROPIO de cada slot cobrado (campo 23)
      const collectedGps = allSlotEntries.reduce((s, e) => s + (e.sd.inner.fields[23] as bigint), 0n)

      // P/V: contabilidad por semana (campos 16/17)
      const weekEndKey = BigInt(weekEndMs)
      const min2n = (a: bigint, b: bigint) => a <= b ? a : b
      const lockedWeeks = (innerRecord.fields[16] ?? new Map()) as Map<bigint, bigint>
      const uncommWeeks = (innerRecord.fields[17] ?? new Map()) as Map<bigint, bigint>
      const MIN_STATS = 2_000_000n

      const lockedEntry = lockedWeeks.get(weekEndKey) ?? 0n
      // P: si se quema el head se libera TODO el remanente; si no, lo cobrado
      const targetRelease = burnRun ? lockedEntry : min2n(collectedGps, lockedEntry)
      const release = min2n(targetRelease, statsLovelace - MIN_STATS)

      const mapSet = (m: Map<bigint, bigint>, k: bigint, v: bigint) =>
        new Map([...m].map(([kk, vv]) => kk === k ? [kk, v] as [bigint, bigint] : [kk, vv] as [bigint, bigint]))
      const mapRemove = (m: Map<bigint, bigint>, k: bigint) =>
        new Map([...m].filter(([kk]) => kk !== k))

      const newLocked = burnRun
        ? mapRemove(lockedWeeks, weekEndKey)
        : mapSet(lockedWeeks, weekEndKey, lockedEntry - release)

      // V: comisión sobre el acumulado semanal con carry
      const carry = (uncommWeeks.get(weekEndKey) ?? 0n) + totalRent
      const commissionDue = carry * weekBps / 10000n
      const commissionPayable = commissionDue >= MIN_COMMISSION_LOVELACE
      const newUncomm = burnRun
        ? mapRemove(uncommWeeks, weekEndKey)
        : commissionPayable
          ? mapSet(uncommWeeks, weekEndKey, 0n)
          : mapSet(uncommWeeks, weekEndKey, carry)

      const newRecordFields = [...innerRecord.fields]
      // rentals_completed cuenta los alquileres reales (Completed/Confirmed). El
      // contrato exige incremento estricto — si solo se cierran Pendings, +1.
      const completedIncrement = BigInt(Math.max(1, collectEntries.length))
      newRecordFields[2] = (innerRecord.fields[2] as bigint) + completedIncrement
      newRecordFields[14] = burnRun
        ? (innerRecord.fields[14] as bigint) - 1n   // P: cierre de semana absorbido
        : innerRecord.fields[14]
      newRecordFields[16] = newLocked
      newRecordFields[17] = newUncomm
      const updatedOwnerDatum = Data.to(new Constr(1, [new Constr(0, newRecordFields)]))
      const statsContinuing = statsLovelace - release

      // ── No-shows: Rent NFTs a quemar ────────────────────────────────────
      const noshowBurns: Record<string, bigint> = {}
      for (const e of allSlotEntries) {
        if (statusOf(e) !== 2) continue
        const nftField = e.sd.inner.fields[11] as Constr<Data>
        if (nftField.index !== 0) continue  // R/U: Confirmed sin NFT — nada que quemar
        noshowBurns[RENT_NFT_POLICY + (nftField.fields[0] as string)] = -1n
      }
      const hasBurns = Object.keys(noshowBurns).length > 0

      // ── Build tx ─────────────────────────────────────────────────────────
      const collectRedeemer    = Data.to(new Constr(4, []))          // CollectSlot
      const forceCloseRedeemer = Data.to(new Constr(10, []))         // ForceClosePending (U: Constr 10)
      const ownersRedeemer     = Data.to(new Constr(1, []))          // CollectPayments
      const burnRedeemer       = Data.to(new Constr(1, [ownerPkh]))  // BurnRentNFT

      const refUtxos = await Promise.all([
        getRentSpendRefUtxo(lucid),
        getOwnersSpendRefUtxo(lucid),
        ...(hasBurns ? [getRentMintRefUtxo(lucid)] : []),
      ])

      let txBuilder = lucid.newTx().readFrom(refUtxos)

      // Un RemovePrev por cada predecesor de run. P: el run que quema el head
      // NO recrea la continuación — su min-ADA vuelve al owner como cambio.
      for (const run of runs) {
        const removePrevRedeemer = Data.to(new Constr(8, [run.newNext!]))
        txBuilder = txBuilder.collectFrom([run.predEntry.utxo], removePrevRedeemer)
        if (run !== burnRun) {
          const newPredDatum = predDatumWithNext(run.predEntry.sd, run.newNext!)
          // Preserve the predecessor's FULL value (may escrow its own Rent NFT)
          txBuilder = txBuilder.pay.ToContract(
            RENT_VALIDATOR_ADDR,
            { kind: 'inline', value: newPredDatum },
            run.predEntry.utxo.assets,
          )
        }
      }

      if (collectEntries.length > 0) {
        txBuilder = txBuilder.collectFrom(collectEntries.map(e => e.utxo), collectRedeemer)
      }
      if (pendingEntries.length > 0) {
        txBuilder = txBuilder.collectFrom(pendingEntries.map(e => e.utxo), forceCloseRedeemer)
      }
      txBuilder = txBuilder
        .collectFrom(
          [{
            txHash: ownerStatsRaw.tx_hash,
            outputIndex: ownerStatsRaw.output_index,
            address: OWNERS_VALIDATOR_ADDR,
            assets: { lovelace: statsLovelace },
            datum: ownerStatsRaw.inline_datum!,
          }],
          ownersRedeemer,
        )
        .pay.ToContract(
          OWNERS_VALIDATOR_ADDR,
          { kind: 'inline', value: updatedOwnerDatum },
          { lovelace: statsContinuing },
        )
        // G: NFT pass-through — prueba de posesión del Owner NFT en tx.inputs
        .pay.ToAddress(walletAddr, { lovelace: nftWalletUtxo.assets.lovelace, [fieldNftUnit]: 1n })
        // D: el owner recibe el rent completo (+ depósitos de Pendings) explícito
        .pay.ToAddress(walletAddr, { lovelace: totalToOwner })
        .addSignerKey(ownerPkh)
        .validFrom(weekEndMs + 1000)  // after(week_end) es abierto

      if (commissionPayable) {
        txBuilder = txBuilder.pay.ToAddress(COMPANY_ADDR, { lovelace: commissionDue })
      }
      if (hasBurns) {
        txBuilder = txBuilder.mintAssets(noshowBurns, burnRedeemer)
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

  return { collectWeek, loading, error }
}
