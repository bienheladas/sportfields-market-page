// Tx: InitWeek — creates the ListHead at rent_spend AND locks this week's
// guarantee in the owner's stats UTxO at owners_spend (LockGuarantee, Mejora E).
// M3: multiple concurrent weeks are allowed — active_weeks_count is incremented,
// not gated on being zero.

import * as React from 'react'
import { Data, Constr, applyParamsToScript } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  RENT_VALIDATOR_ADDR,
  OWNERS_VALIDATOR_ADDR,
  OWNER_NFT_POLICY,
  RENT_VALIDATOR_HASH,
  COMPANY_PKH,
  OWNERS_SPEND_COMPILED,
} from '../lib/config'
import { getAddressUtxos } from '../lib/blockfrost'
import { decodeOwnersDatum } from '../lib/decoders'
import { zonedTimeToUtcMs } from '../lib/timezone'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'
import type { OwnerRecord } from '../components/types'

const HEAD_LOVELACE  = 3_000_000n
const COMMISSION_BPS = 100n

const appliedOwnersSpend = applyParamsToScript(OWNERS_SPEND_COMPILED, [
  new Constr(0, [COMPANY_PKH, OWNER_NFT_POLICY, RENT_VALIDATOR_HASH])
])

export interface DaySchedule {
  enabled: boolean
  open: number   // 0–23, hora LOCAL de la cancha (record.timezone)
  close: number  // 1–24 (exclusive), hora LOCAL de la cancha
}

export interface InitWeekParams {
  /** Monday's calendar date (only Y/M/D read, via UTC getters) — interpreted as
   * midnight in the FIELD's timezone (record.timezone), not literal UTC. */
  weekStart: Date
  rentPriceLovelace: bigint
  cancelDeadlineHours: number
  schedule: DaySchedule[]     // index 0=Mon … 6=Sun
  loyaltyNftsRequired?: number  // default 5
}

export function useInitWeek() {
  const { lucid, pkh: ownerPkh } = useLucid()
  const [loading, setLoading]   = React.useState(false)
  const [error, setError]       = React.useState<string | null>(null)

  const initWeek = React.useCallback(
    async (record: OwnerRecord, params: InitWeekParams): Promise<string[]> => {
      if (!lucid) throw new Error('Wallet no conectada.')

      setLoading(true)
      setError(null)

      try {
        // M3 timezone fix: anchor the week to midnight Monday in the FIELD's
        // local timezone (record.timezone), not literal UTC — otherwise the
        // schedule's "8:00–22:00" ends up meaning UTC hours, not the field's
        // actual opening hours.
        const weekStartMs = zonedTimeToUtcMs(
          params.weekStart.getUTCFullYear(),
          params.weekStart.getUTCMonth() + 1,
          params.weekStart.getUTCDate(),
          0, 0, 0,
          record.timezone,
        )
        const ownerNFTNameHex = record.ownerNFTName
        const fieldNftUnit = OWNER_NFT_POLICY + ownerNFTNameHex

        // Build open_slot_ids from schedule
        const openSlotIds: bigint[] = []
        for (let day = 0; day < 7; day++) {
          const sched = params.schedule[day]
          if (!sched.enabled || sched.open >= sched.close) continue
          for (let hour = sched.open; hour < sched.close; hour++) {
            openSlotIds.push(BigInt(day * 24 + hour + 1))
          }
        }
        if (openSlotIds.length === 0) throw new Error('El horario configurado no tiene slots.')

        // ── CompanyConfig reference input — needed by LockGuarantee for guarantee_bps ──
        const ownersUtxos = await getAddressUtxos(OWNERS_VALIDATOR_ADDR)
        const companyConfigUtxo = ownersUtxos.find(u => {
          if (!u.inline_datum) return false
          try { return decodeOwnersDatum(u.inline_datum).kind === 'Company' } catch { return false }
        })
        if (!companyConfigUtxo) throw new Error('CompanyConfig UTxO no encontrado en el contrato')
        const companyDatum = decodeOwnersDatum(companyConfigUtxo.inline_datum!)
        if (companyDatum.kind !== 'Company') throw new Error('Datum inesperado para CompanyConfig')
        const guaranteeBps = BigInt(companyDatum.config.guaranteeBps)

        // ── Owner stats UTxO ──
        const ownerStatsRaw = ownersUtxos.find(u => {
          if (!u.inline_datum) return false
          if (u.amount.some(a => a.unit === fieldNftUnit)) return false
          try {
            const d = decodeOwnersDatum(u.inline_datum)
            return d.kind === 'Owner' && d.record.ownerNFTName === ownerNFTNameHex
          } catch { return false }
        })
        if (!ownerStatsRaw) throw new Error('Stats UTxO del propietario no encontrado en el contrato')
        const ownerLovelace = BigInt(ownerStatsRaw.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0')

        // ── Owner NFT in wallet (G: sole authority) ──
        const walletAddr = await lucid.wallet().address()
        const walletUtxos = await lucid.wallet().getUtxos()
        const nftWalletUtxo = walletUtxos.find(u => (u.assets[fieldNftUnit] ?? 0n) >= 1n)
        if (!nftWalletUtxo) throw new Error('Owner NFT no encontrado en tu wallet')

        const guaranteePerSlot = params.rentPriceLovelace * guaranteeBps / 10000n
        const guaranteeTotal   = guaranteePerSlot * BigInt(openSlotIds.length)

        // Updated OwnerRecord: guarantee_per_slot for this week's pricing (vestigial display
        // value — M3) + active_weeks_count++ (multiple concurrent weeks allowed)
        const raw = Data.from(ownerStatsRaw.inline_datum!) as Constr<Data>
        const innerRecord = raw.fields[0] as Constr<Data>
        const newRecordFields = [...innerRecord.fields]
        newRecordFields[13] = guaranteePerSlot
        newRecordFields[14] = (innerRecord.fields[14] as bigint) + 1n  // active_weeks_count++ (M3)
        // P/V: entries contables de la semana nueva — PREPEND (el on-chain compara
        // igualdad exacta contra add_locked_week). Semana duplicada = rechazada.
        const weekEndKey  = BigInt(weekStartMs) + 604_800_000n
        const lockedWeeks = (innerRecord.fields[16] ?? new Map()) as Map<bigint, bigint>
        const uncommWeeks = (innerRecord.fields[17] ?? new Map()) as Map<bigint, bigint>
        if ((lockedWeeks.get(weekEndKey) ?? 0n) !== 0n)
          throw new Error('Ya existe una semana activa con ese week_end — semana duplicada.')
        newRecordFields[16] = new Map([[weekEndKey, guaranteeTotal], ...lockedWeeks])
        newRecordFields[17] = new Map([[weekEndKey, 0n], ...uncommWeeks])
        const newStatsDatum = Data.to(new Constr(1, [new Constr(0, newRecordFields)]))

        // WeekConfig = Constr(0, [week_start_posix, slot_duration_ms, cancel_deadline_offset_ms,
        //                         rent_price, site_commission_bps, open_slot_ids,
        //                         loyalty_nfts_required, guarantee_per_slot (M3)])
        const weekConfig = new Constr(0, [
          BigInt(weekStartMs),
          3_600_000n,
          BigInt(params.cancelDeadlineHours * 3_600_000),
          params.rentPriceLovelace,
          COMMISSION_BPS,
          openSlotIds,
          BigInt(params.loyaltyNftsRequired ?? 5),
          guaranteePerSlot,
        ])

        // ListHead = Constr(0, [12 fields])
        const listHead = new Constr(0, [
          ownerNFTNameHex,       // owner_nft_name
          ownerPkh,              // owner_pkh
          COMPANY_PKH,           // company_pkh
          record.fieldName,      // field_name
          record.address,        // field_address
          record.phone,
          record.email,
          record.lat,
          record.long,
          record.paymentAddress,
          weekConfig,
          new Constr(1, []),     // next = Empty
        ])

        // SlotDatum::Head = Constr(0, [listHead])
        const headDatum = Data.to(new Constr(0, [listHead]))

        const lockGuaranteeRedeemer = Data.to(new Constr(5, []))  // LockGuarantee

        const tx = await lucid.newTx()
          .readFrom([{
            txHash: companyConfigUtxo.tx_hash,
            outputIndex: companyConfigUtxo.output_index,
            address: OWNERS_VALIDATOR_ADDR,
            assets: Object.fromEntries(companyConfigUtxo.amount.map(a => [a.unit, BigInt(a.quantity)])),
            datum: companyConfigUtxo.inline_datum!,
          }])
          .collectFrom(
            [{
              txHash: ownerStatsRaw.tx_hash,
              outputIndex: ownerStatsRaw.output_index,
              address: OWNERS_VALIDATOR_ADDR,
              assets: { lovelace: ownerLovelace },
              datum: ownerStatsRaw.inline_datum!,
            }],
            lockGuaranteeRedeemer,
          )
          .attach.SpendingValidator({ type: 'PlutusV3', script: appliedOwnersSpend })
          .pay.ToContract(
            OWNERS_VALIDATOR_ADDR,
            { kind: 'inline', value: newStatsDatum },
            { lovelace: ownerLovelace + guaranteeTotal },
          )
          // NFT pass-through — forces nftWalletUtxo into tx.inputs (proves ownership)
          .pay.ToAddress(walletAddr, { lovelace: nftWalletUtxo.assets.lovelace, [fieldNftUnit]: 1n })
          .pay.ToContract(
            RENT_VALIDATOR_ADDR,
            { kind: 'inline', value: headDatum },
            { lovelace: HEAD_LOVELACE },
          )
          .addSignerKey(ownerPkh)
          .complete()

        const signed = await tx.sign.withWallet().complete()
        const txHash = await signed.submit()
        return [txHash]
      } catch (e) {
        const msg = unwrapSubmitError(e)
        setError(msg)
        throw new Error(msg)
      } finally {
        setLoading(false)
      }
    },
    [lucid, ownerPkh],
  )

  return { initWeek, loading, error }
}
