import { useState, useEffect } from 'react'
import { getAddressUtxos } from '../lib/blockfrost'
import { decodeOwnersDatum } from '../lib/decoders'
import { OWNERS_VALIDATOR_ADDR, OWNER_NFT_POLICY } from '../lib/config'
import type { OwnerRecord } from '../components/types'

// Must be looked up by ownerNFTName, NOT ownerPkh — a single wallet can own
// multiple fields (each with its own OwnerRecord/ownerNFTName), and web
// registrations mint ownerNFTName = ownerPkh + 4 random bytes (32 bytes),
// different from ownerPkh itself. Passing ownerPkh here used to silently
// match nothing for web-registered fields (or the wrong field, for wallets
// owning more than one), defaulting timezone/profile data to null/UTC.
export function useOwnerRecord(ownerNFTName: string | null) {
  const [record, setRecord] = useState<OwnerRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    if (!ownerNFTName) { setRecord(null); return }
    setLoading(true)
    setError(null)
    getAddressUtxos(OWNERS_VALIDATOR_ADDR)
      .then(utxos => {
        // G: stats UTxO has no NFT — find by ownerNFTName in datum
        const nftUnit = OWNER_NFT_POLICY + ownerNFTName
        const utxo = utxos.find(u => {
          if (!u.inline_datum) return false
          if (u.amount.some(a => a.unit === nftUnit)) return false  // skip broken NFT-locked UTxO
          try {
            const d = decodeOwnersDatum(u.inline_datum)
            return d.kind === 'Owner' && d.record.ownerNFTName === ownerNFTName
          } catch { return false }
        }) ?? utxos.find(u => {  // fallback: accept NFT-carrying UTxO if no clean one found
          if (!u.inline_datum) return false
          try {
            const d = decodeOwnersDatum(u.inline_datum)
            return d.kind === 'Owner' && d.record.ownerNFTName === ownerNFTName
          } catch { return false }
        })
        if (!utxo || !utxo.inline_datum) { setRecord(null); return }
        const datum = decodeOwnersDatum(utxo.inline_datum)
        if (datum.kind === 'Owner') setRecord(datum.record)
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [ownerNFTName])

  return { record, loading, error }
}
