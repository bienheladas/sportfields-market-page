// Tx: OpenDispute — Confirmed → Disputed, locks 10 ADA as dispute deposit.

import { useState } from 'react'
import { Data, Constr, applyParamsToScript } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  RENT_VALIDATOR_ADDR,
  RENT_NFT_POLICY,
  COMPANY_PKH,
  OWNER_NFT_POLICY,
  RENT_SPEND_COMPILED,
} from '../lib/config'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'
import type { RentSlotUtxo } from './useRentSlots'

const appliedRentSpend = applyParamsToScript(RENT_SPEND_COMPILED, [
  new Constr(0, [OWNER_NFT_POLICY, RENT_NFT_POLICY])
])

const DISPUTE_DEPOSIT = 10_000_000n

export function useOpenDispute() {
  const { lucid, pkh: customerPkh } = useLucid()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const openDispute = async (slot: RentSlotUtxo): Promise<string> => {
    if (!lucid) throw new Error('Wallet no conectada')

    setLoading(true)
    setError(null)

    try {
      const datum = slot.datum

      // ── Validity: tx lower bound ≥ cancelDeadline (POSIX ms) ────

      // ── Redeemer: OpenDispute = Constr 3 [] ──────────────────────
      const spendRedeemer = Data.to(new Constr(3, []))

      // ── Rent NFT token name ──────────────────────────────────────
      if (!datum.rentNFTName) throw new Error('OpenDispute: datum sin rentNFTName')
      const tokenNameHex = datum.rentNFTName
      const tokenUnit    = RENT_NFT_POLICY + tokenNameHex

      // ── Updated datum: Disputed ──────────────────────────────────
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
        new Constr(5, []),                          // Disputed
        new Constr(0, [datum.customerPkh!]),        // Some(customerPkh)
        new Constr(0, [tokenNameHex]),              // Some(rentNFTName)
        new Constr(0, [DISPUTE_DEPOSIT]),           // Some(disputeDeposit)
        datum.fieldName,
        datum.fieldAddress,
        datum.phone,
        datum.email,
        datum.lat,
        datum.long,
        datum.paymentAddress,
      ]))

      // ── Lovelace: continuing = current + deposit ─────────────────
      const continuingLovelace = slot.lovelace + DISPUTE_DEPOSIT

      // ── Build Tx ─────────────────────────────────────────────────
      const tx = await lucid.newTx()
        .collectFrom(
          [{ txHash: slot.txHash, outputIndex: slot.outputIndex, address: slot.address,
             assets: { lovelace: slot.lovelace, [tokenUnit]: 1n }, datum: slot.rawDatum }],
          spendRedeemer,
        )
        .attach.SpendingValidator({ type: 'PlutusV3', script: appliedRentSpend })
        .pay.ToContract(
          RENT_VALIDATOR_ADDR,
          { kind: 'inline', value: updatedDatum },
          { lovelace: continuingLovelace, [tokenUnit]: 1n },
        )
        .addSignerKey(customerPkh)
        .validFrom(datum.cancelDeadline)
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

  return { openDispute, loading, error }
}
