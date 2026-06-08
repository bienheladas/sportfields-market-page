// Tx: RedeemAtField — transfers Rent NFT to customer wallet (loyalty), Confirmed → Completed.
// next field preserved.

import { useState } from 'react'
import { Data, Constr, applyParamsToScript } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  RENT_VALIDATOR_ADDR,
  RENT_NFT_POLICY,
  OWNER_NFT_POLICY,
  RENT_SPEND_COMPILED,
} from '../lib/config'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'
import { hexToBytes } from '../lib/decoders'

function metaStr(s: string): string | string[] {
  if (s.length <= 64) return s
  const chunks: string[] = []
  for (let i = 0; i < s.length; i += 64) chunks.push(s.slice(i, i + 64))
  return chunks
}

function makeRentNftImage(): string[] {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="96" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0%" stop-color="#f59e0b"/>` +
    `<stop offset="100%" stop-color="#92400e"/>` +
    `</linearGradient></defs>` +
    `<rect width="96" height="96" rx="10" fill="url(#g)"/>` +
    `<rect x="8" y="16" width="80" height="64" rx="2" stroke="rgba(255,255,255,.5)" stroke-width="1.5" fill="none"/>` +
    `<line x1="48" y1="16" x2="48" y2="80" stroke="rgba(255,255,255,.5)" stroke-width="1.5"/>` +
    `<circle cx="48" cy="48" r="12" stroke="rgba(255,255,255,.5)" stroke-width="1.5" fill="none"/>` +
    `<circle cx="48" cy="48" r="2" fill="rgba(255,255,255,.7)"/>` +
    `<rect x="8" y="33" width="14" height="30" stroke="rgba(255,255,255,.35)" stroke-width="1" fill="none"/>` +
    `<rect x="74" y="33" width="14" height="30" stroke="rgba(255,255,255,.35)" stroke-width="1" fill="none"/>` +
    `</svg>`
  const dataUri = `data:image/svg+xml;base64,${btoa(svg)}`
  const chunks: string[] = []
  for (let i = 0; i < dataUri.length; i += 64) chunks.push(dataUri.slice(i, i + 64))
  return chunks
}
import type { RentSlotUtxo } from './useRentSlots'
import type { NodeKey } from '../components/types'

const appliedRentSpend = applyParamsToScript(RENT_SPEND_COMPILED, [
  new Constr(0, [OWNER_NFT_POLICY, RENT_NFT_POLICY])
])

function nodeKeyConstr(nk: NodeKey): Constr<Data> {
  return nk.tag === 'Empty' ? new Constr(1, []) : new Constr(0, [BigInt(nk.key)])
}

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
      if (!datum.rentNFTName) throw new Error('datum.rentNFTName is null — slot not confirmed')
      const tokenUnit   = RENT_NFT_POLICY + datum.rentNFTName
      const customerAddr = await lucid.wallet().address()

      // RedeemAtField = Constr 3 []
      const spendRedeemer = Data.to(new Constr(3, []))

      // Completed datum — next preserved
      const completedDatum = Data.to(new Constr(1, [new Constr(0, [
        BigInt(datum.slotId),
        BigInt(datum.slotStart),
        BigInt(datum.slotEnd),
        BigInt(datum.cancelDeadline),
        datum.rentPrice,
        BigInt(datum.siteCommissionBps),
        datum.ownerNFTName,
        datum.ownerPkh,
        datum.companyPkh,
        new Constr(3, []),                        // Completed
        new Constr(0, [datum.customerPkh!]),      // Some(customerPkh)
        new Constr(1, []),                        // rentNFTName = None
        new Constr(1, []),                        // disputeDeposit = None
        datum.fieldName,
        datum.fieldAddress,
        datum.phone,
        datum.email,
        datum.lat,
        datum.long,
        datum.paymentAddress,
        nodeKeyConstr(datum.next),                // next preserved
        BigInt(datum.weekEnd),                    // week_end
        BigInt(datum.loyaltyNftsRequired),        // loyalty_nfts_required
      ])]))

      // Window closes at week_end (improvement A)
      const validToMs = Math.min(Date.now() + 10 * 60_000, datum.weekEnd - 1)
      const fieldNameText = new TextDecoder().decode(hexToBytes(datum.fieldName))
      const rentNftImage = makeRentNftImage()

      const tx = await lucid.newTx()
        .collectFrom(
          [{ txHash: slot.txHash, outputIndex: slot.outputIndex, address: slot.address,
             assets: { lovelace: slot.lovelace, [tokenUnit]: 1n }, datum: slot.rawDatum }],
          spendRedeemer,
        )
        .attach.SpendingValidator({ type: 'PlutusV3', script: appliedRentSpend })
        .attachMetadata(721, {
          [RENT_NFT_POLICY]: {
            [datum.rentNFTName!]: {
              name: metaStr(`${fieldNameText} — Comprobante`),
              description: metaStr(`Token de lealtad por reserva en "${fieldNameText}". Sportfields.`),
              image: rentNftImage,
            },
          },
        })
        // NFT transferred to customer wallet as loyalty token (not burned)
        .pay.ToAddress(customerAddr, { lovelace: 2_000_000n, [tokenUnit]: 1n })
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
