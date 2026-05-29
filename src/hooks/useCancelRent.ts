// Tx: CancelRent — Confirmed → Available, burns Rent NFT, refunds rentPrice to customer.

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

const MIN_UTXO = 2_100_000n  // min-UTxO for Available slot

export function useCancelRent() {
  const { lucid, pkh: customerPkh, address: customerAddr } = useLucid()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const cancel = async (slot: RentSlotUtxo): Promise<string> => {
    if (!lucid) throw new Error('Wallet no conectada')

    setLoading(true)
    setError(null)

    try {
      const datum = slot.datum
      if (!datum.rentNFTName) throw new Error('datum.rentNFTName is null — slot not confirmed')

      const tokenUnit = RENT_NFT_POLICY + datum.rentNFTName

      // ── Redeemers ────────────────────────────────────────────────
      const spendRedeemer = Data.to(new Constr(2, []))               // CancelRent
      const mintRedeemer  = Data.to(new Constr(1, [customerPkh]))    // BurnRentNFT

      // ── Continuing datum: Available ──────────────────────────────
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
        new Constr(0, []),   // Available
        new Constr(1, []),   // customerPkh = None
        new Constr(1, []),   // rentNFTName = None
        new Constr(1, []),   // disputeDeposit = None
        datum.fieldName,
        datum.fieldAddress,
        datum.phone,
        datum.email,
        datum.lat,
        datum.long,
        datum.paymentAddress,
      ]))

      // ── ValidTo: must be ≤ cancelDeadline, within era horizon ───
      const validToMs = Math.min(Date.now() + 10 * 60_000, datum.cancelDeadline - 1)

      const tx = await lucid.newTx()
        .collectFrom(
          [{ txHash: slot.txHash, outputIndex: slot.outputIndex, address: slot.address,
             assets: { lovelace: slot.lovelace, [tokenUnit]: 1n }, datum: slot.rawDatum }],
          spendRedeemer,
        )
        .attach.SpendingValidator({ type: 'PlutusV3', script: appliedRentSpend })
        .mintAssets({ [tokenUnit]: -1n }, mintRedeemer)
        .attach.MintingPolicy({ type: 'PlutusV3', script: appliedRentMint })
        // Slot returns to Available with min-UTxO
        .pay.ToContract(
          RENT_VALIDATOR_ADDR,
          { kind: 'inline', value: updatedDatum },
          { lovelace: MIN_UTXO },
        )
        // Refund rentPrice to customer
        .pay.ToAddress(customerAddr, { lovelace: datum.rentPrice })
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

  return { cancel, loading, error }
}
