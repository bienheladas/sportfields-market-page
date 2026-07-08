// Tx: ConfirmRent — Pending → Confirmed. Mints the Rent NFT, customer pays the
// remaining balance (rent_price - 50% deposit already locked at reserve time).

import { useState } from 'react'
import { Data, Constr, applyParamsToScript } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  RENT_VALIDATOR_ADDR,
  RENT_NFT_POLICY,
  OWNER_NFT_POLICY,
  COMPANY_PKH,
  RENT_SPEND_COMPILED,
  RENT_MINT_COMPILED,
} from '../lib/config'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'
import { hexToBytes } from '../lib/decoders'
import { rentNftMetadata721 } from '../lib/rentNftMetadata'
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

export function useConfirmRent() {
  const { lucid, pkh: customerPkh } = useLucid()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const confirmRent = async (slot: RentSlotUtxo): Promise<string> => {
    if (!lucid) throw new Error('Wallet no conectada')
    if (slot.datum.status !== 'Pending') throw new Error('Solo se puede confirmar un slot Pending')

    setLoading(true)
    setError(null)

    try {
      const datum = slot.datum
      if (!datum.customerPkh) throw new Error('Slot Pending sin customerPkh')
      if (datum.customerPkh !== customerPkh)
        throw new Error('Este slot fue reservado por otra wallet')

      // Token name = first 4 bytes of ownerNFTName + customerPkh
      // Field-specific suffix: LAST 4 bytes of ownerNFTName (the random suffix
      // appended at registration), not the first 4 (which are the owner's pkh
      // prefix — identical across every field that owner registers).
      const rentNFTName = datum.ownerNFTName.slice(-8) + customerPkh
      const rentNFTUnit = RENT_NFT_POLICY + rentNFTName

      const completedDeposit = slot.lovelace

      const contDatum = Data.to(new Constr(1, [new Constr(0, [
        BigInt(datum.slotId),
        BigInt(datum.slotStart),
        BigInt(datum.slotEnd),
        BigInt(datum.cancelDeadline),
        datum.rentPrice,
        BigInt(datum.siteCommissionBps),
        datum.ownerNFTName,
        datum.ownerPkh,
        datum.companyPkh,
        new Constr(2, []),                  // status = Confirmed
        new Constr(0, [customerPkh]),       // customerPkh preserved
        // R: con lealtad apagada la confirmación NO mintea Rent NFT
        datum.loyaltyNftsRequired === 0 ? new Constr(1, []) : new Constr(0, [rentNFTName]),
        new Constr(1, []),                  // disputeDeposit = None
        datum.fieldName,
        datum.fieldAddress,
        datum.phone,
        datum.email,
        datum.lat,
        datum.long,
        datum.paymentAddress,
        nodeKeyConstr(datum.next),          // next preserved
        BigInt(datum.weekEnd),
        BigInt(datum.loyaltyNftsRequired),
        datum.guaranteePerSlot,              // guarantee_per_slot — M3
      ])]))

      const spendRedeemer = Data.to(new Constr(0, []))             // ConfirmRent
      const mintRedeemer  = Data.to(new Constr(0, [customerPkh]))  // MintRentNFT

      const fieldNameText = new TextDecoder().decode(hexToBytes(datum.fieldName))

      let txBuilder = lucid.newTx()
        .collectFrom(
          [{ txHash: slot.txHash, outputIndex: slot.outputIndex, address: slot.address,
             assets: { lovelace: completedDeposit }, datum: slot.rawDatum }],
          spendRedeemer,
        )
        .attach.SpendingValidator({ type: 'PlutusV3', script: appliedRentSpend })
        .addSignerKey(customerPkh)

      if (datum.loyaltyNftsRequired === 0) {
        // R: lealtad apagada — confirmar pagando el resto, sin mint
        txBuilder = txBuilder.pay.ToContract(
          RENT_VALIDATOR_ADDR,
          { kind: 'inline', value: contDatum },
          { lovelace: datum.rentPrice },
        )
      } else {
        txBuilder = txBuilder
          .mintAssets({ [rentNFTUnit]: 1n }, mintRedeemer)
          .attach.MintingPolicy({ type: 'PlutusV3', script: appliedRentMint })
          .attachMetadata(721, rentNftMetadata721(RENT_NFT_POLICY, rentNFTName, fieldNameText))
          .pay.ToContract(
            RENT_VALIDATOR_ADDR,
            { kind: 'inline', value: contDatum },
            { lovelace: datum.rentPrice, [rentNFTUnit]: 1n },
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

  return { confirmRent, loading, error, remaining: (slot: RentSlotUtxo) =>
    slot.datum.rentPrice > slot.lovelace ? slot.datum.rentPrice - slot.lovelace : 0n }
}
