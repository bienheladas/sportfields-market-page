import * as React from 'react'
import { Data, Constr } from '@lucid-evolution/lucid'
import axios from 'axios'
import { useLucid } from '../lib/LucidContext'
import { decodeRentDatum } from '../lib/decoders'
import {
  BLOCKFROST_KEY, BLOCKFROST_URL,
  RENT_VALIDATOR_ADDR,
  COMPANY_PKH,
  OWNER_NFT_POLICY,
  RENT_NFT_POLICY,
  RENT_SPEND_COMPILED,
} from '../lib/config'
import type { OwnerRecord } from '../components/types'

const BATCH_SIZE    = 24
const SLOT_LOVELACE = 3_000_000n
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
}

export interface InitWeekProgress {
  totalSlots: number
  batchCount: number
  currentBatch: number
  txHashes: string[]
}

export function useInitWeek() {
  const { lucid, pkh: ownerPkh } = useLucid()
  const [loading, setLoading]   = React.useState(false)
  const [error, setError]       = React.useState<string | null>(null)
  const [progress, setProgress] = React.useState<InitWeekProgress | null>(null)

  const initWeek = React.useCallback(
    async (record: OwnerRecord, params: InitWeekParams): Promise<string[]> => {
      if (!lucid) throw new Error('Wallet no conectada.')

      setLoading(true)
      setError(null)
      setProgress(null)

      try {
        const weekStartMs = params.weekStart.getTime()
        const ownerNFTNameHex = ownerPkh  // token name = pkh

        const allSlots: { slotId: number; datum: string }[] = []

        for (let day = 0; day < 7; day++) {
          const sched = params.schedule[day]
          if (!sched.enabled || sched.open >= sched.close) continue
          for (let hour = sched.open; hour < sched.close; hour++) {
            const slotId         = day * 24 + hour + 1
            const slotStart      = weekStartMs + (slotId - 1) * 3_600_000
            const slotEnd        = slotStart + 3_600_000
            const cancelDeadline = slotStart - params.cancelDeadlineHours * 3_600_000

            const datum = Data.to(new Constr(0, [
              BigInt(slotId),
              BigInt(slotStart),
              BigInt(slotEnd),
              BigInt(cancelDeadline),
              params.rentPriceLovelace,
              COMMISSION_BPS,
              ownerNFTNameHex,
              ownerPkh,
              COMPANY_PKH,
              new Constr(0, []),   // Available
              new Constr(1, []),   // customerPkh = None
              new Constr(1, []),   // rentNFTName = None
              new Constr(1, []),   // disputeDeposit = None
              record.fieldName,
              record.address,
              record.phone,
              record.email,
              record.lat,
              record.long,
              record.paymentAddress,
            ]))

            allSlots.push({ slotId, datum })
          }
        }

        if (allSlots.length === 0) throw new Error('El horario configurado no tiene slots.')

        // Filter out slots already on-chain for this owner this week
        const existingIds = await fetchExistingSlotIds(ownerPkh, weekStartMs)
        const pendingSlots = allSlots.filter(s => !existingIds.has(s.slotId))
        if (pendingSlots.length === 0) throw new Error('Todos los slots de esta semana ya fueron creados.')

        const batches: typeof allSlots[] = []
        for (let i = 0; i < pendingSlots.length; i += BATCH_SIZE)
          batches.push(pendingSlots.slice(i, i + BATCH_SIZE))

        const txHashes: string[] = []
        setProgress({ totalSlots: pendingSlots.length, batchCount: batches.length, currentBatch: 1, txHashes: [] })

        for (let b = 0; b < batches.length; b++) {
          setProgress({ totalSlots: pendingSlots.length, batchCount: batches.length, currentBatch: b + 1, txHashes: [...txHashes] })

          let txBuilder = lucid.newTx()
          for (const slot of batches[b]) {
            txBuilder = txBuilder.pay.ToContract(
              RENT_VALIDATOR_ADDR,
              { kind: 'inline', value: slot.datum },
              { lovelace: SLOT_LOVELACE },
            )
          }

          const tx     = await txBuilder.complete()
          const signed = await tx.sign.withWallet().complete()

          let txHash: string
          let alreadyConfirmed = false
          try {
            txHash = await signed.submit()
          } catch (submitErr) {
            const msg = submitErr instanceof Error ? submitErr.message : String(submitErr)
            if (msg.includes('already been included') || msg.includes('inputs are spent')) {
              alreadyConfirmed = true
              txHash = '(ya confirmado)'
            } else {
              throw submitErr
            }
          }
          txHashes.push(txHash)

          if (b < batches.length - 1) {
            if (!alreadyConfirmed) await waitForTx(txHash)
          }
        }

        setProgress({ totalSlots: pendingSlots.length, batchCount: batches.length, currentBatch: batches.length, txHashes })
        return txHashes
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

  return { initWeek, loading, error, progress }
}

async function fetchExistingSlotIds(ownerPkh: string, weekStartMs: number): Promise<Set<number>> {
  const weekEndMs = weekStartMs + 7 * 24 * 3_600_000
  const ids = new Set<number>()
  let page = 1
  while (true) {
    const r = await axios.get(
      `${BLOCKFROST_URL}/addresses/${RENT_VALIDATOR_ADDR}/utxos?count=100&page=${page}`,
      { headers: { project_id: BLOCKFROST_KEY } },
    ).catch(() => null)
    if (!r || !Array.isArray(r.data) || r.data.length === 0) break
    for (const utxo of r.data) {
      const hex: string | undefined = utxo.inline_datum
      if (!hex) continue
      try {
        const d = decodeRentDatum(hex)
        if (d.ownerNFTName === ownerPkh && d.slotStart >= weekStartMs && d.slotStart < weekEndMs)
          ids.add(d.slotId)
      } catch { /* skip malformed */ }
    }
    if (r.data.length < 100) break
    page++
  }
  return ids
}

async function waitForTx(txHash: string): Promise<void> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    try {
      const r = await axios.get(`${BLOCKFROST_URL}/txs/${txHash}`, {
        headers: { project_id: BLOCKFROST_KEY },
      })
      if (r.data?.hash) return
    } catch { /* 404 = pending */ }
    await new Promise(r => setTimeout(r, 5_000))
  }
  throw new Error(`Tx ${txHash.slice(0, 8)}… no confirmada en 2 min`)
}
