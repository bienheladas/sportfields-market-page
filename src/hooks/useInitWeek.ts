import * as React from 'react'
import { useWallet } from '@meshsdk/react'
import { BlockfrostProvider, MeshTxBuilder } from '@meshsdk/core'
import { Serialization } from '@cardano-sdk/core'
import axios from 'axios'
import type { OwnerRecord } from '../components/types'
import { buildRentDatumHex, pAvailable, pNothing } from '../lib/plutus-cbor'
import { normalizeMeshUtxos, normalizeAddress, decodeRentDatum } from '../lib/decoders'
import { addressToPkh } from './useReserveSlot'
import {
  BLOCKFROST_KEY, BLOCKFROST_URL,
  RENT_VALIDATOR_ADDR, COMPANY_PKH,
} from '../lib/config'

const BATCH_SIZE     = 24
const SLOT_LOVELACE  = '3000000'
const COMMISSION_BPS = 100

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
  const { wallet, connected } = useWallet()
  const [loading, setLoading]   = React.useState(false)
  const [error, setError]       = React.useState<string | null>(null)
  const [progress, setProgress] = React.useState<InitWeekProgress | null>(null)

  const initWeek = React.useCallback(
    async (record: OwnerRecord, params: InitWeekParams): Promise<string[]> => {
      if (!connected || !wallet) throw new Error('Wallet no conectada.')

      setLoading(true)
      setError(null)
      setProgress(null)

      try {
        const walletAddress = normalizeAddress(await wallet.getChangeAddress())
        const ownerPkh      = addressToPkh(walletAddress)
        const weekStartMs   = params.weekStart.getTime()

        const allSlots: { slotId: number; datumHex: string }[] = []

        for (let day = 0; day < 7; day++) {
          const sched = params.schedule[day]
          if (!sched.enabled || sched.open >= sched.close) continue
          for (let hour = sched.open; hour < sched.close; hour++) {
            const slotId         = day * 24 + hour + 1
            const slotStart      = weekStartMs + (slotId - 1) * 3_600_000
            const slotEnd        = slotStart + 3_600_000
            const cancelDeadline = slotStart - params.cancelDeadlineHours * 3_600_000

            allSlots.push({
              slotId,
              datumHex: buildRentDatumHex({
                slotId,
                slotStart,
                slotEnd,
                cancelDeadline,
                rentPrice:      Number(params.rentPriceLovelace),
                commissionBps:  COMMISSION_BPS,
                ownerNFTName:   Buffer.from(ownerPkh, 'hex'),
                ownerPkh:       Buffer.from(ownerPkh, 'hex'),
                companyPkh:     Buffer.from(COMPANY_PKH, 'hex'),
                status:         pAvailable(),
                customerPkh:    pNothing(),
                rentNFTName:    pNothing(),
                disputeDeposit: pNothing(),
                fieldName:      Buffer.from(record.fieldName, 'hex'),
                fieldAddress:   Buffer.from(record.address, 'hex'),
                phone:          Buffer.from(record.phone, 'hex'),
                email:          Buffer.from(record.email, 'hex'),
                lat:            Buffer.from(record.lat, 'hex'),
                long_:          Buffer.from(record.long, 'hex'),
                paymentAddress: Buffer.from(record.paymentAddress, 'hex'),
              }),
            })
          }
        }

        if (allSlots.length === 0) throw new Error('El horario configurado no tiene slots.')

        const provider = new BlockfrostProvider(BLOCKFROST_KEY)

        // Filter out slots already on-chain for this owner this week
        const existingIds = await fetchExistingSlotIds(ownerPkh, params.weekStart.getTime())
        const pendingSlots = allSlots.filter(s => !existingIds.has(s.slotId))
        if (pendingSlots.length === 0) throw new Error('Todos los slots de esta semana ya fueron creados.')
        const slotsToCreate = pendingSlots

        const batches: typeof allSlots[] = []
        for (let i = 0; i < slotsToCreate.length; i += BATCH_SIZE)
          batches.push(slotsToCreate.slice(i, i + BATCH_SIZE))

        const txHashes: string[] = []
        setProgress({ totalSlots: slotsToCreate.length, batchCount: batches.length, currentBatch: 1, txHashes: [] })

        let currentUtxos = normalizeMeshUtxos((await wallet.getUtxos()) as unknown[])

        for (let b = 0; b < batches.length; b++) {
          setProgress({ totalSlots: slotsToCreate.length, batchCount: batches.length, currentBatch: b + 1, txHashes: [...txHashes] })

          const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider })
          txBuilder.changeAddress(walletAddress).selectUtxosFrom(currentUtxos)

          for (const slot of batches[b]) {
            txBuilder
              .txOut(RENT_VALIDATOR_ADDR, [{ unit: 'lovelace', quantity: SLOT_LOVELACE }])
              .txOutInlineDatumValue(slot.datumHex, 'CBOR')
          }

          const unsignedTx  = await txBuilder.complete()
          const cip30Result = await wallet.signTx(unsignedTx, false)
          const firstByte   = parseInt(cip30Result.slice(0, 2), 16)

          let finalTxHex: string
          if (firstByte >= 0x80 && firstByte <= 0x9f) {
            finalTxHex = cip30Result
          } else {
            const tx     = Serialization.Transaction.fromCbor(Serialization.TxCBOR(unsignedTx))
            const witSet = Serialization.TransactionWitnessSet.fromCbor(cip30Result as any)
            const txWit  = tx.witnessSet()
            const vkeys  = witSet.vkeys()
            if (vkeys && vkeys.size() > 0) txWit.setVkeys(vkeys)
            tx.setWitnessSet(txWit)
            finalTxHex = String(tx.toCbor())
          }

          let txHash: string
          let alreadyConfirmed = false
          try {
            txHash = await provider.submitTx(finalTxHex)
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
            currentUtxos = normalizeMeshUtxos((await wallet.getUtxos()) as unknown[])
          }
        }

        setProgress({ totalSlots: slotsToCreate.length, batchCount: batches.length, currentBatch: batches.length, txHashes })
        return txHashes
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        throw new Error(msg)
      } finally {
        setLoading(false)
      }
    },
    [wallet, connected],
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
