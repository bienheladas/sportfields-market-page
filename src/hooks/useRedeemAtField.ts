// Tx: RedeemAtField — burns Rent NFT, Confirmed → Completed.

import { useState } from 'react'
import { Data, Constr, applyParamsToScript } from '@lucid-evolution/lucid'
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
import type { RentSlotUtxo } from './useRentSlots'

const appliedRentSpend = applyParamsToScript(RENT_SPEND_COMPILED, [
  new Constr(0, [OWNER_NFT_POLICY, RENT_NFT_POLICY])
])
const appliedRentMint = applyParamsToScript(RENT_MINT_COMPILED, [
  new Constr(0, [COMPANY_PKH])
])

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

      // ── Rent NFT token name ──────────────────────────────────────
      if (!datum.rentNFTName) throw new Error('datum.rentNFTName is null — slot not confirmed')
      const tokenNameHex = datum.rentNFTName
      const tokenUnit    = RENT_NFT_POLICY + tokenNameHex

      // ── Redeemers ────────────────────────────────────────────────
      // RedeemAtField = Constr 4 []
      const spendRedeemer = Data.to(new Constr(4, []))
      // BurnRentNFT = Constr 1 [signerPkh]
      const mintRedeemer  = Data.to(new Constr(1, [customerPkh]))

      // ── Completed datum ──────────────────────────────────────────
      const completedDatum = Data.to(new Constr(0, [
        BigInt(datum.slotId),
        BigInt(datum.slotStart),
        BigInt(datum.slotEnd),
        BigInt(datum.cancelDeadline),
        datum.rentPrice,
        BigInt(datum.siteCommissionBps),
        datum.ownerNFTName,
        datum.ownerPkh,
        datum.companyPkh,
        new Constr(3, []),                         // Completed
        new Constr(0, [datum.customerPkh!]),       // Some(customerPkh)
        new Constr(1, []),                         // rentNFTName = None
        new Constr(1, []),                         // disputeDeposit = None
        datum.fieldName,
        datum.fieldAddress,
        datum.phone,
        datum.email,
        datum.lat,
        datum.long,
        datum.paymentAddress,
      ]))

      // ── ValidTo: avoid TimeTranslationPastHorizon ────────────────
      const validToMs = Math.min(Date.now() + 10 * 60_000, datum.slotEnd - 1)

      // ── Build Tx ─────────────────────────────────────────────────
      const tx = await lucid.newTx()
        .collectFrom(
          [{ txHash: slot.txHash, outputIndex: slot.outputIndex, address: slot.address,
             assets: { lovelace: slot.lovelace, [tokenUnit]: 1n }, datum: slot.rawDatum }],
          spendRedeemer,
        )
        .attach.SpendingValidator({ type: 'PlutusV3', script: appliedRentSpend })
        .mintAssets({ [tokenUnit]: -1n }, mintRedeemer)
        .attach.MintingPolicy({ type: 'PlutusV3', script: appliedRentMint })
        .pay.ToContract(
          RENT_VALIDATOR_ADDR,
          { kind: 'inline', value: completedDatum },
          { lovelace: slot.lovelace },
        )
        .addSignerKey(customerPkh)
        .validTo(validToMs)
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

  return { redeemAtField, loading, error }
}
