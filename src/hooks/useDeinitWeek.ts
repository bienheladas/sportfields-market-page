// Tx: DeinitWeek — owner closes an empty ListHead (next === Empty) AND decrements
// active_weeks_count on the stats UTxO (ClearActiveWeek, M3) by 1 — multiple
// concurrent weeks are allowed, so this only closes the week being deinitialized.
//
// Old-format registrations (Owner NFT locked inside owners_spend stats UTxO)
// cannot be handled here because spending that UTxO requires accessing
// guarantee_per_slot (field 13) which is absent in pre-improvement-E datums.
// Use the off-chain deinit-week.mjs script for those.

import { useState } from 'react'
import { Data, Constr } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  OWNERS_VALIDATOR_ADDR,
  OWNER_NFT_POLICY,
} from '../lib/config'
import { getAddressUtxos } from '../lib/blockfrost'
import { decodeOwnersDatum } from '../lib/decoders'
import { getRentSpendRefUtxo, getOwnersSpendRefUtxo } from '../lib/refScripts'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'
import type { ListHeadUtxo } from './useRentSlots'

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

      // ── Owner stats UTxO (to clear active_week) ──
      const ownersUtxos = await getAddressUtxos(OWNERS_VALIDATOR_ADDR)
      const ownerStatsRaw = ownersUtxos.find(u => {
        if (!u.inline_datum) return false
        if (u.amount.some(a => a.unit === fieldNftUnit)) return false
        try {
          const d = decodeOwnersDatum(u.inline_datum)
          return d.kind === 'Owner' && d.record.ownerNFTName === fieldNftName
        } catch { return false }
      })
      if (!ownerStatsRaw) throw new Error('Stats UTxO del propietario no encontrado en el contrato')
      const ownerLovelace = BigInt(ownerStatsRaw.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0')

      const raw = Data.from(ownerStatsRaw.inline_datum!) as Constr<Data>
      const innerRecord = raw.fields[0] as Constr<Data>
      const currentActiveWeeksCount = innerRecord.fields[14] as bigint
      if (currentActiveWeeksCount <= 0n)
        throw new Error('active_weeks_count ya es 0 — no hay semana activa que cerrar')
      const newRecordFields = [...innerRecord.fields]
      newRecordFields[14] = currentActiveWeeksCount - 1n  // active_weeks_count-- (M3)
      const newStatsDatum = Data.to(new Constr(1, [new Constr(0, newRecordFields)]))

      const deinitRedeemer          = Data.to(new Constr(9, []))  // DeinitWeek (rent_spend)
      const clearActiveWeekRedeemer = Data.to(new Constr(6, []))  // ClearActiveWeek (owners_spend)

      const [headUtxo] = await lucid.utxosByOutRef([{ txHash: head.txHash, outputIndex: head.outputIndex }])
      if (!headUtxo) throw new Error('ListHead UTxO no encontrado en la cadena')

      // rent_spend (9.4 KB) + owners_spend (5.5 KB) inline exceed the 16.384 B tx
      // limit — read both from their deployed reference script UTxOs instead.
      const [rentSpendRefUtxo, ownersSpendRefUtxo] = await Promise.all([
        getRentSpendRefUtxo(lucid),
        getOwnersSpendRefUtxo(lucid),
      ])

      // Paying the NFT back to wallet forces coin selection to include nftWalletUtxo
      // as a tx input, satisfying owner_nft_present() in check_deinit_week.
      const tx = await lucid.newTx()
        .readFrom([rentSpendRefUtxo, ownersSpendRefUtxo])
        .collectFrom([headUtxo], deinitRedeemer)
        .collectFrom(
          [{
            txHash: ownerStatsRaw.tx_hash,
            outputIndex: ownerStatsRaw.output_index,
            address: OWNERS_VALIDATOR_ADDR,
            assets: { lovelace: ownerLovelace },
            datum: ownerStatsRaw.inline_datum!,
          }],
          clearActiveWeekRedeemer,
        )
        .pay.ToContract(
          OWNERS_VALIDATOR_ADDR,
          { kind: 'inline', value: newStatsDatum },
          { lovelace: ownerLovelace },
        )
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
