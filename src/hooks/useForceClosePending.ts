// Tx: ForceClosePending — owner forecloses an abandoned Pending slot once
// cancel_deadline has passed (customer never confirmed). Slot is removed from
// the list; owner receives the ≥50% deposit.

import { useState } from 'react'
import { Data, Constr, applyParamsToScript } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  RENT_VALIDATOR_ADDR,
  OWNER_NFT_POLICY,
  RENT_NFT_POLICY,
  RENT_SPEND_COMPILED,
} from '../lib/config'
import { decodeRentDatum, decodeListHeadDatum } from '../lib/decoders'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'
import type { RentSlotUtxo } from './useRentSlots'
import type { NodeKey } from '../components/types'

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

export function useForceClosePending() {
  const { lucid, pkh: ownerPkh } = useLucid()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const forceClosePending = async (slot: RentSlotUtxo): Promise<string> => {
    if (!lucid) throw new Error('Wallet no conectada')
    const datum = slot.datum
    if (datum.status !== 'Pending') throw new Error('Solo se puede forzar el cierre de un slot Pending')
    if (Date.now() <= datum.cancelDeadline)
      throw new Error(`El cancel_deadline aún no pasó (${new Date(datum.cancelDeadline).toISOString()})`)

    setLoading(true)
    setError(null)

    try {
      const fieldNftUnit = OWNER_NFT_POLICY + datum.ownerNFTName

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

      const walletAddr = await lucid.wallet().address()
      const walletUtxos = await lucid.wallet().getUtxos()
      const nftWalletUtxo = walletUtxos.find(u => (u.assets[fieldNftUnit] ?? 0n) >= 1n)
      if (!nftWalletUtxo) throw new Error('Owner NFT no encontrado en tu wallet')

      const newPredDatum = rebuildPredDatum(predRawDatum, nodeKeyConstr(datum.next))

      const removePrevRedeemer        = Data.to(new Constr(8, [nodeKeyConstr(datum.next)]))  // RemovePrev
      const forceClosePendingRedeemer = Data.to(new Constr(11, []))                           // ForceClosePending

      const tx = await lucid.newTx()
        .collectFrom([predUtxo], removePrevRedeemer)
        .collectFrom([freshSlotUtxo], forceClosePendingRedeemer)
        .attach.SpendingValidator({ type: 'PlutusV3', script: appliedRentSpend })
        // Predecessor continues — preserve its FULL value, not just lovelace
        .pay.ToContract(RENT_VALIDATOR_ADDR, { kind: 'inline', value: newPredDatum }, predUtxo.assets)
        // Owner receives the deposit (≥50%)
        .pay.ToAddress(walletAddr, { lovelace: slot.lovelace })
        // NFT pass-through — forces nftWalletUtxo into tx.inputs (proves ownership)
        .pay.ToAddress(walletAddr, { lovelace: nftWalletUtxo.assets.lovelace, [fieldNftUnit]: 1n })
        .addSignerKey(ownerPkh)
        .validFrom(datum.cancelDeadline + 1000)  // after() es abierto: estrictamente posterior
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

  return { forceClosePending, loading, error }
}
