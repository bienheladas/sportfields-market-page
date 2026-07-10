// useRecoverOldField.ts — recovers stranded OwnerRecord UTxOs at the previous
// owners_spend address (before the add_locked_week sorted-insertion fix, 2026-07-09).
// The stats UTxO for "Deportop - Sede Javier Prado" (and the test field) ended up at
// the old address after the fix-only redeploy that changed owners_spend again.
// Recovery requires two steps:
//   1. DeinitWeek — closes the empty week head, releases locked guarantee (92 ADA)
//   2. DeregisterField — burns Owner NFT, consumes leftover stats (2 ADA)
// Step 1 can only run after week_end. After both steps, re-register the field.

import { useState, useEffect } from 'react'
import { Data, Constr, applyParamsToScript } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  RENT_VALIDATOR_ADDR,
  OWNER_NFT_POLICY,
  COMPANY_ADDR,
  COMPANY_PKH,
  REGISTRATION_FEE_LOVELACE,
  OWNERS_MINT_COMPILED,
} from '../lib/config'
import { getAddressUtxos, type BlockfrostUtxo } from '../lib/blockfrost'
import { decodeOwnersDatum } from '../lib/decoders'
import { getRentSpendRefUtxo } from '../lib/refScripts'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'

// Old owners_spend — the P/V/R/U deploy (2026-07-09) address, before the
// add_locked_week sorted-insertion fix that bumped the address again.
const OLD_OWNERS_SPEND_ADDR = 'addr_test1wz4dxrv497x9fzzy8xzcc9nad3lnlse2gqw5n8g3mcyk6vgqy7jed'
const OLD_OWNERS_SPEND_REF_TXHASH = 'b65cb8d22b4b521ce797c27b362c4dddba5f9fc929de4887f96701278d0533b0'
const OLD_OWNERS_SPEND_REF_INDEX = 0

// owners_minting_policy didn't change — same compiled bytecode as current config.
const appliedOwnersMint = applyParamsToScript(OWNERS_MINT_COMPILED, [
  new Constr(0, [COMPANY_PKH, REGISTRATION_FEE_LOVELACE, 0n])
])

export interface StrandedField {
  statsRaw: BlockfrostUtxo
  ownerNFTName: string
  fieldName: string
  lovelace: bigint
  lockedWeeks: Map<bigint, bigint>
  uncommissionedWeeks: Map<bigint, bigint>
  activeWeeksCount: bigint
  /** null when lockedWeeks is empty (already deinited, waiting for deregister) */
  weekEnd: bigint | null
}

export function useStrandedOwnerFields(ownerPkh: string | null) {
  const [strandedFields, setStrandedFields] = useState<StrandedField[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!ownerPkh) { setStrandedFields([]); return }
    setLoading(true)
    getAddressUtxos(OLD_OWNERS_SPEND_ADDR)
      .then(utxos => {
        const found: StrandedField[] = []
        for (const u of utxos) {
          if (!u.inline_datum) continue
          try {
            const d = decodeOwnersDatum(u.inline_datum)
            if (d.kind !== 'Owner') continue
            if (d.record.ownerPkh !== ownerPkh) continue
            const raw = Data.from(u.inline_datum) as Constr<Data>
            const rec = raw.fields[0] as Constr<Data>
            const lockedWeeks = (rec.fields[16] ?? new Map()) as Map<bigint, bigint>
            const uncommWeeks = (rec.fields[17] ?? new Map()) as Map<bigint, bigint>
            const activeWeeksCount = (rec.fields[14] ?? 0n) as bigint
            const lovelace = BigInt(u.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0')
            const weekEnd = lockedWeeks.size > 0 ? [...lockedWeeks.keys()][0] : null
            found.push({
              statsRaw: u,
              ownerNFTName: d.record.ownerNFTName,
              fieldName: d.record.fieldName,
              lovelace,
              lockedWeeks,
              uncommissionedWeeks: uncommWeeks,
              activeWeeksCount,
              weekEnd,
            })
          } catch { continue }
        }
        setStrandedFields(found)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [ownerPkh])

  return { strandedFields, loadingStranded: loading }
}

export function useRecoverOldField() {
  const { lucid, pkh: ownerPkh } = useLucid()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Step 1: DeinitWeek + ClearActiveWeek on the old owners_spend address. */
  const deinitOldWeek = async (field: StrandedField): Promise<string> => {
    if (!lucid || !ownerPkh) throw new Error('Wallet no conectada')
    if (field.activeWeeksCount <= 0n) throw new Error('No hay semana activa para cerrar')
    setLoading(true)
    setError(null)
    try {
      const fieldNftUnit = OWNER_NFT_POLICY + field.ownerNFTName
      const walletAddr = await lucid.wallet().address()
      const allWalletUtxos = await lucid.wallet().getUtxos()
      const nftWalletUtxo = allWalletUtxos.find(u => (u.assets[fieldNftUnit] ?? 0n) >= 1n)
      if (!nftWalletUtxo) throw new Error('Owner NFT no encontrado en tu wallet')

      // Find the HEAD at rent_spend for this ownerNFTName
      const rentUtxos = await getAddressUtxos(RENT_VALIDATOR_ADDR)
      let headRaw: BlockfrostUtxo | undefined
      let weekEndKey = 0n
      let siteCommissionBps = 100

      for (const u of rentUtxos) {
        if (!u.inline_datum) continue
        try {
          const d = Data.from(u.inline_datum) as Constr<Data>
          if (d.index !== 0) continue // SlotDatum::Head = Constr 0
          const listHead = d.fields[0] as Constr<Data>
          const ownerNFTNameHex = listHead.fields[0] as string
          if (ownerNFTNameHex !== field.ownerNFTName) continue
          const config = listHead.fields[10] as Constr<Data>
          weekEndKey = (config.fields[0] as bigint) + 604_800_000n
          siteCommissionBps = Number(config.fields[4] as bigint)
          const nextField = listHead.fields[11] as Constr<Data>
          if (nextField.index !== 0)
            throw new Error('El ListHead todavía tiene slots — cobralos primero')
          headRaw = u
          break
        } catch (inner) {
          if (inner instanceof Error && inner.message.includes('slots')) throw inner
          continue
        }
      }
      if (!headRaw) throw new Error('ListHead no encontrado en rent_spend para esta cancha')

      const [headUtxo] = await lucid.utxosByOutRef([
        { txHash: headRaw.tx_hash, outputIndex: headRaw.output_index }
      ])
      if (!headUtxo) throw new Error('ListHead UTxO no encontrado on-chain')

      // Build new stats datum
      const statsD = Data.from(field.statsRaw.inline_datum!) as Constr<Data>
      const rec = statsD.fields[0] as Constr<Data>
      const newRecFields = [...rec.fields]
      newRecFields[14] = (rec.fields[14] as bigint) - 1n  // active_weeks_count--
      const min2n = (a: bigint, b: bigint) => a <= b ? a : b
      const lockedEntry = field.lockedWeeks.get(weekEndKey) ?? 0n
      const release = min2n(lockedEntry, field.lovelace - 2_000_000n)
      const carry = field.uncommissionedWeeks.get(weekEndKey) ?? 0n
      const commissionDue = carry * BigInt(siteCommissionBps) / 10000n
      const commissionPayable = commissionDue >= 1_000_000n
      const mapRemove = (m: Map<bigint, bigint>, k: bigint) =>
        new Map([...m].filter(([kk]) => kk !== k))
      newRecFields[16] = mapRemove(field.lockedWeeks, weekEndKey)
      newRecFields[17] = mapRemove(field.uncommissionedWeeks, weekEndKey)
      const newStatsDatum = Data.to(new Constr(1, [new Constr(0, newRecFields)]))

      const deinitRedeemer = Data.to(new Constr(9, []))  // DeinitWeek (rent_spend)
      const clearRedeemer  = Data.to(new Constr(6, []))  // ClearActiveWeek (owners_spend)

      const [rentSpendRefUtxo, oldOwnersSpendRefUtxo] = await Promise.all([
        getRentSpendRefUtxo(lucid),
        lucid.utxosByOutRef([{
          txHash: OLD_OWNERS_SPEND_REF_TXHASH,
          outputIndex: OLD_OWNERS_SPEND_REF_INDEX,
        }]).then(([u]) => {
          if (!u) throw new Error('Old ownersSpendRef no encontrado on-chain')
          return u
        }),
      ])

      let txBuilder = lucid.newTx()
        .readFrom([rentSpendRefUtxo, oldOwnersSpendRefUtxo])
        .collectFrom([headUtxo], deinitRedeemer)
        .collectFrom(
          [{
            txHash: field.statsRaw.tx_hash,
            outputIndex: field.statsRaw.output_index,
            address: OLD_OWNERS_SPEND_ADDR,
            assets: { lovelace: field.lovelace },
            datum: field.statsRaw.inline_datum!,
          }],
          clearRedeemer,
        )
        .pay.ToContract(
          OLD_OWNERS_SPEND_ADDR,
          { kind: 'inline', value: newStatsDatum },
          { lovelace: field.lovelace - release },
        )
        .pay.ToAddress(walletAddr, { lovelace: nftWalletUtxo.assets.lovelace, [fieldNftUnit]: 1n })
        .validFrom(Number(weekEndKey) + 1_000)
        .validTo(Date.now() + 4 * 3_600_000)
        .addSignerKey(ownerPkh)
      if (commissionPayable) {
        txBuilder = txBuilder.pay.ToAddress(COMPANY_ADDR, { lovelace: commissionDue })
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

  /** Step 2: DeregisterField + BurnOwnerNFT on the old owners_spend address. */
  const deregisterOldField = async (field: StrandedField): Promise<string> => {
    if (!lucid || !ownerPkh) throw new Error('Wallet no conectada')
    setLoading(true)
    setError(null)
    try {
      const ownerNftUnit = OWNER_NFT_POLICY + field.ownerNFTName
      const walletUtxos = await lucid.wallet().getUtxos()
      const nftUtxo = walletUtxos.find(u => (u.assets[ownerNftUnit] ?? 0n) >= 1n)
      if (!nftUtxo) throw new Error('Owner NFT no encontrado en tu wallet')

      // Re-fetch stats in case it was updated by deinit
      const oldUtxos = await getAddressUtxos(OLD_OWNERS_SPEND_ADDR)
      const statsRaw = oldUtxos.find(u => {
        if (!u.inline_datum) return false
        try {
          const d = decodeOwnersDatum(u.inline_datum)
          return d.kind === 'Owner' && d.record.ownerNFTName === field.ownerNFTName
        } catch { return false }
      })
      if (!statsRaw) throw new Error('Stats UTxO no encontrado — puede que ya hayas completado la recuperación')

      const statsD = Data.from(statsRaw.inline_datum!) as Constr<Data>
      const rec = statsD.fields[0] as Constr<Data>
      const activeWeeksCount = rec.fields[14] as bigint
      if (activeWeeksCount !== 0n)
        throw new Error('active_weeks_count != 0 — cerrá la semana primero')

      const statsLovelace = BigInt(statsRaw.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0')

      const deregisterRedeemer = Data.to(new Constr(7, []))  // DeregisterField
      const burnRedeemer       = Data.to(new Constr(1, []))  // BurnOwnerNFT

      const [oldOwnersSpendRefUtxo] = await lucid.utxosByOutRef([{
        txHash: OLD_OWNERS_SPEND_REF_TXHASH,
        outputIndex: OLD_OWNERS_SPEND_REF_INDEX,
      }])
      if (!oldOwnersSpendRefUtxo) throw new Error('Old ownersSpendRef no encontrado on-chain')

      const tx = await lucid.newTx()
        .readFrom([oldOwnersSpendRefUtxo])
        .collectFrom(
          [{
            txHash: statsRaw.tx_hash,
            outputIndex: statsRaw.output_index,
            address: OLD_OWNERS_SPEND_ADDR,
            assets: { lovelace: statsLovelace },
            datum: statsRaw.inline_datum!,
          }],
          deregisterRedeemer,
        )
        .mintAssets({ [ownerNftUnit]: -1n }, burnRedeemer)
        .attach.MintingPolicy({ type: 'PlutusV3', script: appliedOwnersMint })
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

  return { deinitOldWeek, deregisterOldField, loading, error }
}
