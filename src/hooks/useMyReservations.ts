import { useState, useEffect } from 'react'
import { getAddressUtxos } from '../lib/blockfrost'
import { decodeRentDatum } from '../lib/decoders'
import { RENT_VALIDATOR_ADDR } from '../lib/config'
import type { RentDatum, SlotStatus } from '../components/types'
import type { RentSlotUtxo } from './useRentSlots'

const CUSTOMER_STATUSES: SlotStatus[] = ['Confirmed', 'Completed', 'Refunded', 'Disputed']

export function useMyReservations(customerPkh: string | null) {
  const [slots, setSlots] = useState<RentSlotUtxo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = () => {
    if (!customerPkh) { setSlots([]); return }
    setLoading(true)
    setError(null)
    getAddressUtxos(RENT_VALIDATOR_ADDR)
      .then(utxos => {
        const parsed: RentSlotUtxo[] = []
        for (const u of utxos) {
          if (!u.inline_datum) continue
          try {
            const datum: RentDatum | null = decodeRentDatum(u.inline_datum)
            if (!datum) continue  // Head datum — skip
            if (datum.customerPkh !== customerPkh) continue
            if (!CUSTOMER_STATUSES.includes(datum.status)) continue
            const lovelace = BigInt(u.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0')
            parsed.push({ txHash: u.tx_hash, outputIndex: u.output_index, datum, lovelace,
              address: RENT_VALIDATOR_ADDR, rawDatum: u.inline_datum! })
          } catch { /* skip malformed */ }
        }
        parsed.sort((a, b) => a.datum.slotStart - b.datum.slotStart)
        setSlots(parsed)
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [customerPkh])

  return { slots, loading, error, reload }
}
