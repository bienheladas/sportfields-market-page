// Tx: Reserve slot — Available → Confirmed + mint Rent NFT to customer.

import { useState } from 'react'
import { Data, Constr, applyParamsToScript, fromText } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  RENT_VALIDATOR_ADDR,
  RENT_NFT_POLICY,
  COMPANY_PKH,
  OWNER_NFT_POLICY,
  RENT_SPEND_COMPILED,
  RENT_MINT_COMPILED,
} from '../lib/config'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'
import type { RentSlotUtxoLike } from '../components/WeekCalendar'

const appliedRentSpend = applyParamsToScript(RENT_SPEND_COMPILED, [
  new Constr(0, [OWNER_NFT_POLICY, RENT_NFT_POLICY])
])
const appliedRentMint = applyParamsToScript(RENT_MINT_COMPILED, [
  new Constr(0, [COMPANY_PKH])
])

function isoYearWeek(dateMs: number): { year: number; week: number } {
  const d = new Date(dateMs)
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return { year: d.getUTCFullYear(), week }
}

export function useReserveSlot() {
  const { lucid, pkh: customerPkh, address: customerAddr } = useLucid()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const reserve = async (slot: RentSlotUtxoLike): Promise<string> => {
    if (!lucid) throw new Error('Wallet no conectada')

    setLoading(true)
    setError(null)

    try {
      const datum = slot.datum

      // ── Fetch fresh UTxO from chain (has address + inline datum) ──
      const allUtxos = await lucid.utxosAt(RENT_VALIDATOR_ADDR)
      const slotUtxo = allUtxos.find(u => u.txHash === slot.txHash && u.outputIndex === slot.outputIndex)
      if (!slotUtxo) throw new Error('Slot UTxO no encontrado en la cadena')
      if (!slotUtxo.datum) throw new Error('Slot UTxO sin datum inline')

      // ── Token name: "{year}-W{week}-S{slotId}" ────────────────────
      const { year, week } = isoYearWeek(datum.slotStart)
      const tokenNameStr   = `${year}-W${week}-S${datum.slotId}`
      const tokenNameHex   = fromText(tokenNameStr)
      if (tokenNameHex.length / 2 > 32) throw new Error(`Token name too long: ${tokenNameStr}`)
      const tokenUnit      = RENT_NFT_POLICY + tokenNameHex

      // ── Redeemers ─────────────────────────────────────────────────
      // Reserve { customer_pkh } = Constr 0 [pkh]
      const spendRedeemer = Data.to(new Constr(0, [customerPkh]))
      // MintRentNFT { customer_pkh } = Constr 0 [pkh]
      const mintRedeemer  = Data.to(new Constr(0, [customerPkh]))

      // ── Confirmed datum ────────────────────────────────────────────
      const updatedDatum = Data.to(new Constr(0, [
        BigInt(datum.slotId),
        BigInt(datum.slotStart),
        BigInt(datum.slotEnd),
        BigInt(datum.cancelDeadline),
        datum.rentPrice,
        BigInt(datum.siteCommissionBps),
        datum.ownerNFTName,
        datum.ownerPkh,
        datum.companyPkh,
        new Constr(2, []),                        // status = Confirmed
        new Constr(0, [customerPkh]),             // customerPkh = Some(pkh)
        new Constr(0, [tokenNameHex]),            // rentNFTName = Some(name)
        new Constr(1, []),                        // disputeDeposit = None
        datum.fieldName,
        datum.fieldAddress,
        datum.phone,
        datum.email,
        datum.lat,
        datum.long,
        datum.paymentAddress,
      ]))

      // Continuing = current lovelace + rentPrice
      const continuingLovelace = slotUtxo.assets.lovelace + datum.rentPrice

      // ── ValidTo: avoid TimeTranslationPastHorizon ────────────────
      const validToMs = Math.min(Date.now() + 10 * 60_000, datum.slotEnd - 1)

      const tx = await lucid.newTx()
        .collectFrom([slotUtxo], spendRedeemer)
        .attach.SpendingValidator({ type: 'PlutusV3', script: appliedRentSpend })
        .mintAssets({ [tokenUnit]: 1n }, mintRedeemer)
        .attach.MintingPolicy({ type: 'PlutusV3', script: appliedRentMint })
        .pay.ToContract(
          RENT_VALIDATOR_ADDR,
          { kind: 'inline', value: updatedDatum },
          { lovelace: continuingLovelace },
        )
        .pay.ToAddress(customerAddr, { lovelace: 2_000_000n, [tokenUnit]: 1n })
        .addSignerKey(customerPkh)
        .validTo(validToMs)
        .complete()

      const signed  = await tx.sign.withWallet().complete()
      return await signed.submit()
    } catch (e: unknown) {
      const msg = unwrapSubmitError(e)
      setError(msg)
      throw new Error(msg)
    } finally {
      setLoading(false)
    }
  }

  return { reserve, loading, error }
}
