// Tx: RedeemFree — customer burns N loyalty NFTs (from previous visits) + the
// slot's own NFT (N+1 total) to redeem a Confirmed slot for free. Slot is
// removed from the list; rent_price is refunded in full (it was never spent).

import { useState } from 'react'
import { Data, Constr, applyParamsToScript } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  RENT_VALIDATOR_ADDR,
  OWNER_NFT_POLICY,
  RENT_NFT_POLICY,
  COMPANY_PKH,
  RENT_SPEND_COMPILED,
  RENT_MINT_COMPILED,
} from '../lib/config'
import { decodeRentDatum, decodeListHeadDatum } from '../lib/decoders'
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

/** Loyalty token unit for a given owner+customer pair (fungible-like, same name across all their slots).
 *  Field-specific suffix: LAST 4 bytes of ownerNFTName (the random registration suffix),
 *  not the first 4 (the owner's pkh prefix — shared across every field that owner registers). */
export function loyaltyNftUnit(ownerNFTName: string, customerPkh: string): string {
  return RENT_NFT_POLICY + ownerNFTName.slice(-8) + customerPkh
}

export function useRedeemFree() {
  const { lucid, pkh: customerPkh } = useLucid()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const redeemFree = async (slot: RentSlotUtxo): Promise<string> => {
    if (!lucid) throw new Error('Wallet no conectada')
    const datum = slot.datum
    if (datum.status !== 'Confirmed') throw new Error('Solo se puede canjear gratis un slot Confirmed')
    if (datum.customerPkh !== customerPkh) throw new Error('Este slot fue reservado por otra wallet')

    setLoading(true)
    setError(null)

    try {
      const loyaltyUnit = loyaltyNftUnit(datum.ownerNFTName, customerPkh)

      const walletUtxos = await lucid.wallet().getUtxos()
      const loyaltyBalance = walletUtxos.reduce((sum, u) => sum + (u.assets[loyaltyUnit] ?? 0n), 0n)
      if (loyaltyBalance < BigInt(datum.loyaltyNftsRequired))
        throw new Error(
          `Necesitás ${datum.loyaltyNftsRequired} NFT(s) de lealtad de esta cancha — tenés ${loyaltyBalance}.`
        )

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

      const newPredDatum = rebuildPredDatum(predRawDatum, nodeKeyConstr(datum.next))
      const totalBurn = BigInt(datum.loyaltyNftsRequired) + 1n  // N de la wallet + 1 del contrato

      const removePrevRedeemer = Data.to(new Constr(8, [nodeKeyConstr(datum.next)]))  // RemovePrev
      const redeemFreeRedeemer = Data.to(new Constr(10, []))                          // RedeemFree
      const burnRedeemer       = Data.to(new Constr(1, [customerPkh]))                // BurnRentNFT

      const customerAddr = await lucid.wallet().address()

      const tx = await lucid.newTx()
        .collectFrom([predUtxo], removePrevRedeemer)
        .collectFrom([freshSlotUtxo], redeemFreeRedeemer)
        .attach.SpendingValidator({ type: 'PlutusV3', script: appliedRentSpend })
        .mintAssets({ [loyaltyUnit]: -totalBurn }, burnRedeemer)
        .attach.MintingPolicy({ type: 'PlutusV3', script: appliedRentMint })
        // Predecessor continues — preserve its FULL value, not just lovelace
        .pay.ToContract(RENT_VALIDATOR_ADDR, { kind: 'inline', value: newPredDatum }, predUtxo.assets)
        .pay.ToAddress(customerAddr, { lovelace: datum.rentPrice })
        .addSignerKey(customerPkh)
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

  return { redeemFree, loading, error }
}
