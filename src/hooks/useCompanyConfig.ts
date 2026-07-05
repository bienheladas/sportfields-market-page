import { useState, useEffect, useCallback } from 'react'
import { getAddressUtxos } from '../lib/blockfrost'
import { decodeOwnersDatum } from '../lib/decoders'
import { OWNERS_VALIDATOR_ADDR } from '../lib/config'
import type { CompanyConfig } from '../components/types'

export function useCompanyConfig() {
  const [config, setConfig] = useState<CompanyConfig | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    getAddressUtxos(OWNERS_VALIDATOR_ADDR)
      .then(utxos => {
        for (const u of utxos) {
          if (!u.inline_datum) continue
          try {
            const d = decodeOwnersDatum(u.inline_datum)
            if (d.kind === 'Company') { setConfig(d.config); return }
          } catch { /* skip */ }
        }
        setConfig(null)
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { reload() }, [reload])

  return { config, loading, error, reload }
}
