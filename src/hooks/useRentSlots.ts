import { useState, useEffect } from 'react'
import { getAddressUtxos } from '../lib/blockfrost'
import { decodeRentDatum } from '../lib/decoders'
import { RENT_VALIDATOR_ADDR, OWNERS_MINT_POLICY_ID } from '../lib/config'
import type { RentDatum } from '../components/types'

export interface RentSlotUtxo {
  txHash: string
  outputIndex: number
  datum: RentDatum
  lovelace: bigint
}

export function useRentSlots(ownerNFTNameHex?: string) {
  const [slots, setSlots]   = useState<RentSlotUtxo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const reload = () => {
    setLoading(true)
    setError(null)
    getAddressUtxos(RENT_VALIDATOR_ADDR)
      .then(utxos => {
        const filtered = utxos

        const parsed: RentSlotUtxo[] = []
        for (const u of filtered) {
          if (!u.inline_datum) continue
          try {
            const datum = decodeRentDatum(u.inline_datum)
            if (ownerNFTNameHex && datum.ownerNFTName !== ownerNFTNameHex) continue
            const lovelace = BigInt(u.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0')
            parsed.push({ txHash: u.tx_hash, outputIndex: u.output_index, datum, lovelace })
          } catch (e) {
            console.warn('[useRentSlots] decode failed for', u.tx_hash, '#', u.output_index,
              '— inline_datum prefix:', u.inline_datum?.slice(0, 20), '— error:', e)
          }
        }
        parsed.sort((a, b) => a.datum.slotId - b.datum.slotId)
        console.log('[useRentSlots] total UTxOs from Blockfrost:', utxos.length,
          '| decoded slots:', parsed.length,
          '| statuses:', parsed.map(s => `${s.datum.slotId}:${s.datum.status}`).join(', '))
        setSlots(parsed)
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [ownerNFTNameHex])

  return { slots, loading, error, reload }
}
