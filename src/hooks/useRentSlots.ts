import { useState, useEffect } from 'react'
import { getAddressUtxos } from '../lib/blockfrost'
import { decodeRentDatum, decodeListHeadDatum } from '../lib/decoders'
import { RENT_VALIDATOR_ADDR } from '../lib/config'
import type { RentDatum, ListHeadDatum } from '../components/types'

export interface RentSlotUtxo {
  txHash: string
  outputIndex: number
  datum: RentDatum
  lovelace: bigint
  address: string   // script address (RENT_VALIDATOR_ADDR)
  rawDatum: string  // inline datum CBOR hex — needed for collectFrom
}

export interface ListHeadUtxo {
  txHash: string
  outputIndex: number
  datum: ListHeadDatum
  lovelace: bigint
  rawDatum: string
}

export function useRentSlots(ownerNFTNameHex?: string, ownerPkhHex?: string) {
  const [slots, setSlots]     = useState<RentSlotUtxo[]>([])
  const [heads, setHeads]     = useState<ListHeadUtxo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const reload = () => {
    setLoading(true)
    setError(null)
    getAddressUtxos(RENT_VALIDATOR_ADDR)
      .then(utxos => {
        const parsedSlots: RentSlotUtxo[] = []
        const parsedHeads: ListHeadUtxo[] = []
        for (const u of utxos) {
          if (!u.inline_datum) continue
          const lovelace = BigInt(u.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0')
          try {
            const datum = decodeRentDatum(u.inline_datum)
            if (datum === null) {
              // It's a Head — filter by ownerPkh (reliable) or ownerNFTName as fallback
              const headDatum = decodeListHeadDatum(u.inline_datum)
              const matchesPkh = ownerPkhHex && headDatum.ownerPkh === ownerPkhHex
              const matchesName = ownerNFTNameHex && headDatum.ownerNFTName === ownerNFTNameHex
              if ((ownerPkhHex || ownerNFTNameHex) && !matchesPkh && !matchesName) continue
              parsedHeads.push({
                txHash: u.tx_hash, outputIndex: u.output_index, datum: headDatum,
                lovelace, rawDatum: u.inline_datum,
              })
            } else {
              if (ownerNFTNameHex && datum.ownerNFTName !== ownerNFTNameHex) continue
              parsedSlots.push({
                txHash: u.tx_hash, outputIndex: u.output_index, datum, lovelace,
                address: RENT_VALIDATOR_ADDR, rawDatum: u.inline_datum,
              })
            }
          } catch (e) {
            console.warn('[useRentSlots] decode failed for', u.tx_hash, '#', u.output_index,
              '— inline_datum prefix:', u.inline_datum?.slice(0, 20), '— error:', e)
          }
        }
        parsedSlots.sort((a, b) => a.datum.slotId - b.datum.slotId)
        console.log('[useRentSlots] total UTxOs:', utxos.length,
          '| heads:', parsedHeads.length,
          '| nodes:', parsedSlots.length,
          '| statuses:', parsedSlots.map(s => `${s.datum.slotId}:${s.datum.status}`).join(', '))
        setSlots(parsedSlots)
        setHeads(parsedHeads)
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [ownerNFTNameHex, ownerPkhHex])

  return { slots, heads, loading, error, reload }
}
