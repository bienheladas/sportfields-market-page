// Tx 7 — OpenDispute: Confirmed → Disputed, locks extra 10 ADA as dispute deposit.

import { useState } from 'react'
import { useWallet } from '@meshsdk/react'
import { BlockfrostProvider, MeshTxBuilder } from '@meshsdk/core'
import axios from 'axios'
import {
  BLOCKFROST_KEY,
  BLOCKFROST_URL,
  RENT_VALIDATOR_ADDR,
  RENT_REF_TXHASH,
  RENT_REF_INDEX,
  RENT_MINT_POLICY_ID,
} from '../lib/config'
import {
  pConstr, pInt, pBytes,
  pConfirmed, pNothing, pJust,
  pDisputed,
  buildRentDatumHex,
} from '../lib/plutus-cbor'
import { Serialization } from '@cardano-sdk/core'
import { fixScriptDataHash } from '../lib/fixScriptDataHash'
import { normalizeMeshUtxos, normalizeAddress } from '../lib/decoders'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'
import { addressToPkh } from './useReserveSlot'
import type { RentSlotUtxo } from './useRentSlots'

async function posixMsToCardanoSlot(posixMs: number): Promise<number> {
  const blockResp = await axios.get(`${BLOCKFROST_URL}/blocks/latest`, {
    headers: { project_id: BLOCKFROST_KEY },
  })
  const refSlot   = blockResp.data.slot as number
  const refTimeMs = (blockResp.data.time as number) * 1000
  return refSlot + Math.floor((posixMs - refTimeMs) / 1000)
}

const DISPUTE_DEPOSIT = 10_000_000n

export function useOpenDispute() {
  const { wallet, connected } = useWallet()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openDispute = async (slot: RentSlotUtxo): Promise<string> => {
    if (!connected || !wallet) throw new Error('Wallet no conectada')

    setLoading(true)
    setError(null)

    try {
      const provider = new BlockfrostProvider(BLOCKFROST_KEY)
      const datum = slot.datum

      // ── Customer identity ────────────────────────────────────────
      const walletAddress = normalizeAddress(await wallet.getChangeAddress())
      const customerPkh = addressToPkh(walletAddress)

      // ── Validity: tx lower bound ≥ cancelDeadline ────────────────
      const cancelDeadlineCardano = await posixMsToCardanoSlot(datum.cancelDeadline)

      // ── Redeemer: Constr 3 [] — OpenDispute ─────────────────────
      const validatorRedeemerHex = pConstr(3, []).toString('hex')

      // ── Current datum hex (Confirmed) ────────────────────────────
      const currentDatumHex = buildRentDatumHex({
        slotId: datum.slotId,
        slotStart: datum.slotStart,
        slotEnd: datum.slotEnd,
        cancelDeadline: datum.cancelDeadline,
        rentPrice: Number(datum.rentPrice),
        commissionBps: datum.siteCommissionBps,
        ownerNFTName: Buffer.from(datum.ownerNFTName, 'hex'),
        ownerPkh: Buffer.from(datum.ownerPkh, 'hex'),
        companyPkh: Buffer.from(datum.companyPkh, 'hex'),
        status: pConfirmed(),
        customerPkh: pJust(pBytes(Buffer.from(datum.customerPkh!, 'hex'))),
        rentNFTName: datum.rentNFTName
          ? pJust(pBytes(Buffer.from(datum.rentNFTName, 'hex')))
          : pNothing(),
        disputeDeposit: pNothing(),
        fieldName: Buffer.from(datum.fieldName, 'hex'),
        fieldAddress: Buffer.from(datum.fieldAddress, 'hex'),
        phone: Buffer.from(datum.phone, 'hex'),
        email: Buffer.from(datum.email, 'hex'),
        lat: Buffer.from(datum.lat, 'hex'),
        long_: Buffer.from(datum.long, 'hex'),
        paymentAddress: Buffer.from(datum.paymentAddress, 'hex'),
      })

      // ── Updated datum hex (Disputed) ─────────────────────────────
      const updatedDatumHex = buildRentDatumHex({
        slotId: datum.slotId,
        slotStart: datum.slotStart,
        slotEnd: datum.slotEnd,
        cancelDeadline: datum.cancelDeadline,
        rentPrice: Number(datum.rentPrice),
        commissionBps: datum.siteCommissionBps,
        ownerNFTName: Buffer.from(datum.ownerNFTName, 'hex'),
        ownerPkh: Buffer.from(datum.ownerPkh, 'hex'),
        companyPkh: Buffer.from(datum.companyPkh, 'hex'),
        status: pDisputed(),
        customerPkh: pJust(pBytes(Buffer.from(datum.customerPkh!, 'hex'))),
        rentNFTName: datum.rentNFTName
          ? pJust(pBytes(Buffer.from(datum.rentNFTName, 'hex')))
          : pNothing(),
        disputeDeposit: pJust(pInt(DISPUTE_DEPOSIT)),
        fieldName: Buffer.from(datum.fieldName, 'hex'),
        fieldAddress: Buffer.from(datum.fieldAddress, 'hex'),
        phone: Buffer.from(datum.phone, 'hex'),
        email: Buffer.from(datum.email, 'hex'),
        lat: Buffer.from(datum.lat, 'hex'),
        long_: Buffer.from(datum.long, 'hex'),
        paymentAddress: Buffer.from(datum.paymentAddress, 'hex'),
      })

      // ── Token name of the Rent NFT (must be deposited into contract) ─
      if (!datum.rentNFTName) throw new Error('OpenDispute: datum sin rentNFTName')
      const tokenNameHex = datum.rentNFTName
      const tokenUnit    = RENT_MINT_POLICY_ID + tokenNameHex

      // ── Lovelace: continuing = current + deposit ─────────────────
      const continuingLovelace = slot.lovelace + DISPUTE_DEPOSIT

      // ── Wallet UTxOs ─────────────────────────────────────────────
      const rawUtxos = await wallet.getUtxos()
      const utxos = normalizeMeshUtxos(rawUtxos as unknown[])

      const collateralUtxo = utxos.find(u => {
        const amt = u.output.amount
        return amt.length === 1 && amt[0].unit === 'lovelace' && BigInt(amt[0].quantity) >= 5_000_000n
      })
      if (!collateralUtxo) throw new Error('No hay UTxO puro-ADA ≥ 5 ADA para colateral')

      // ── Build Tx ─────────────────────────────────────────────────
      const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider })

      txBuilder
        .spendingPlutusScriptV3()
        .txIn(
          slot.txHash, slot.outputIndex,
          [{ unit: 'lovelace', quantity: String(slot.lovelace) }],
          RENT_VALIDATOR_ADDR,
        )
        .txInInlineDatumPresent()
        .txInRedeemerValue(validatorRedeemerHex, 'CBOR', { mem: 14_000_000, steps: 10_000_000_000 })
        .spendingTxInReference(RENT_REF_TXHASH, RENT_REF_INDEX)
        .txOut(RENT_VALIDATOR_ADDR, [
          { unit: 'lovelace', quantity: String(continuingLovelace) },
          { unit: tokenUnit,  quantity: '1' },
        ])
        .txOutInlineDatumValue(updatedDatumHex, 'CBOR')
        .invalidBefore(cancelDeadlineCardano)
        .txInCollateral(
          collateralUtxo.input.txHash,
          collateralUtxo.input.outputIndex,
          collateralUtxo.output.amount,
          collateralUtxo.output.address,
        )
        .requiredSignerHash(customerPkh)
        .changeAddress(walletAddress)
        .selectUtxosFrom(utxos)

      const unsignedTx = await txBuilder.complete()

      // ── Fix script data hash ─────────────────────────────────────
      const fixedTx = await fixScriptDataHash(
        unsignedTx,
        {
          tx_hash: slot.txHash,
          output_index: slot.outputIndex,
          amount: [{ unit: 'lovelace', quantity: String(slot.lovelace) }],
          inline_datum: currentDatumHex,
          address: RENT_VALIDATOR_ADDR,
        },
        collateralUtxo,
      )

      // ── Sign & submit (witness-merge pattern) ────────────────────
      const cip30Result = await wallet.signTx(fixedTx, true)
      const firstByte = parseInt(cip30Result.slice(0, 2), 16)
      let finalTxHex: string
      if (firstByte >= 0x80 && firstByte <= 0x9f) {
        finalTxHex = cip30Result
      } else {
        const tx = Serialization.Transaction.fromCbor(Serialization.TxCBOR(fixedTx))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const witSet = Serialization.TransactionWitnessSet.fromCbor(cip30Result as any)
        const txWit = tx.witnessSet()
        const vkeys = witSet.vkeys()
        if (vkeys && vkeys.size() > 0) txWit.setVkeys(vkeys)
        tx.setWitnessSet(txWit)
        finalTxHex = String(tx.toCbor())
      }

      return await provider.submitTx(finalTxHex)
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
