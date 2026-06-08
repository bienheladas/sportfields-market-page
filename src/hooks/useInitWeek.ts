import * as React from 'react'
import { Data, Constr } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  RENT_VALIDATOR_ADDR,
  COMPANY_PKH,
} from '../lib/config'
import type { OwnerRecord } from '../components/types'

const HEAD_LOVELACE  = 3_000_000n
const COMMISSION_BPS = 100n

export interface DaySchedule {
  enabled: boolean
  open: number   // 0–23
  close: number  // 1–24 (exclusive)
}

export interface InitWeekParams {
  weekStart: Date             // Monday 00:00:00 UTC
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
        const weekStartMs = params.weekStart.getTime()
        const ownerNFTNameHex = record.ownerNFTName

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

        // WeekConfig = Constr(0, [week_start_posix, slot_duration_ms, cancel_deadline_offset_ms,
        //                         rent_price, site_commission_bps, open_slot_ids, loyalty_nfts_required])
        const weekConfig = new Constr(0, [
          BigInt(weekStartMs),
          3_600_000n,
          BigInt(params.cancelDeadlineHours * 3_600_000),
          params.rentPriceLovelace,
          COMMISSION_BPS,
          openSlotIds,
          BigInt(params.loyaltyNftsRequired ?? 5),
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
        const datum = Data.to(new Constr(0, [listHead]))

        const tx = await lucid.newTx()
          .pay.ToContract(
            RENT_VALIDATOR_ADDR,
            { kind: 'inline', value: datum },
            { lovelace: HEAD_LOVELACE },
          )
          .complete()

        const signed = await tx.sign.withWallet().complete()
        const txHash = await signed.submit()
        return [txHash]
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
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

