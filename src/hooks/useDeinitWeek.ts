// Tx: DeinitWeek — owner closes an empty ListHead (next === Empty).
// Spends: ListHead only (DeinitWeek redeemer on rent_spend).
// The stats UTxO is NOT spent — check_deinit_week only needs the Owner NFT
// present in tx.inputs, which coin selection satisfies automatically via
// the pay.ToAddress(NFT) output.
//
// Old-format registrations (Owner NFT locked inside owners_spend stats UTxO)
// cannot be handled here because spending that UTxO requires accessing
// guarantee_per_slot (field 13) which is absent in pre-improvement-E datums.
// Use the off-chain deinit-week.mjs script for those.

import { useState } from 'react'
import { Data, Constr, applyParamsToScript } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  OWNER_NFT_POLICY,
  RENT_NFT_POLICY,
  RENT_SPEND_COMPILED,
} from '../lib/config'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'
import type { ListHeadUtxo } from './useRentSlots'

const appliedRentSpend = applyParamsToScript(RENT_SPEND_COMPILED, [
  new Constr(0, [OWNER_NFT_POLICY, RENT_NFT_POLICY])
])

export function useDeinitWeek() {
  const { lucid, pkh: ownerPkh } = useLucid()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const deinitWeek = async (head: ListHeadUtxo): Promise<string> => {
    if (!lucid) throw new Error('Wallet no conectada')
    if (head.datum.next.tag !== 'Empty') throw new Error('El ListHead todavía tiene slots — cobrá todos primero')

    setLoading(true)
    setError(null)

    try {
      const fieldNftName = head.datum.ownerNFTName
      const fieldNftUnit = OWNER_NFT_POLICY + fieldNftName

      // Owner NFT must be in wallet (improvement G / new format).
      // Old-format registrations have the NFT locked in owners_spend — unsupported here.
      const walletAddr = await lucid.wallet().address()
      const allWalletUtxos = await lucid.wallet().getUtxos()
      const nftWalletUtxo = allWalletUtxos.find(u => (u.assets[fieldNftUnit] ?? 0n) >= 1n)
      if (!nftWalletUtxo) {
        throw new Error(
          'Owner NFT no encontrado en tu wallet. ' +
          'Esta semana fue registrada en formato antiguo (NFT en el contrato). ' +
          'Usá el script off-chain deinit-week.mjs para cerrarla.'
        )
      }

      const deinitRedeemer = Data.to(new Constr(9, []))  // DeinitWeek

      const [headUtxo] = await lucid.utxosByOutRef([{ txHash: head.txHash, outputIndex: head.outputIndex }])
      if (!headUtxo) throw new Error('ListHead UTxO no encontrado en la cadena')

      // Paying the NFT back to wallet forces coin selection to include nftWalletUtxo
      // as a tx input, satisfying owner_nft_present() in check_deinit_week.
      const tx = await lucid.newTx()
        .collectFrom([headUtxo], deinitRedeemer)
        .attach.SpendingValidator({ type: 'PlutusV3', script: appliedRentSpend })
        .pay.ToAddress(walletAddr, { lovelace: nftWalletUtxo.assets.lovelace, [fieldNftUnit]: 1n })
        .addSignerKey(ownerPkh)
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

  return { deinitWeek, loading, error }
}
