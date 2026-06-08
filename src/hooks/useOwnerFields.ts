import { useState, useEffect, useCallback } from 'react'
import { getAddressUtxos } from '../lib/blockfrost'
import { decodeOwnersDatum } from '../lib/decoders'
import { OWNERS_VALIDATOR_ADDR, OWNER_NFT_POLICY } from '../lib/config'
import type { OwnerRecord } from '../components/types'

export interface OwnerField {
  ownerNFTName: string
  nftUnit: string
  record: OwnerRecord
  lovelace: bigint
  txHash: string
  outputIndex: number
  rawDatum: string
}

export function useOwnerFields(ownerPkh: string | null) {
  const [fields, setFields] = useState<OwnerField[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!ownerPkh) { setFields([]); return }
    setLoading(true)
    setError(null)
    getAddressUtxos(OWNERS_VALIDATOR_ADDR)
      .then(utxos => {
        const result: OwnerField[] = []
        for (const u of utxos) {
          if (!u.inline_datum) continue
          try {
            const d = decodeOwnersDatum(u.inline_datum)
            if (d.kind !== 'Owner') continue
            if (d.record.ownerPkh !== ownerPkh) continue
            const nftUnit = OWNER_NFT_POLICY + d.record.ownerNFTName
            if (u.amount.some(a => a.unit === nftUnit)) continue
            result.push({
              ownerNFTName: d.record.ownerNFTName,
              nftUnit,
              record: d.record,
              lovelace: BigInt(u.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0'),
              txHash: u.tx_hash,
              outputIndex: u.output_index,
              rawDatum: u.inline_datum,
            })
          } catch { /* skip undecoded UTxOs */ }
        }
        setFields(result)
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [ownerPkh])

  useEffect(() => { load() }, [load])

  return { fields, loading, error, reload: load }
}
