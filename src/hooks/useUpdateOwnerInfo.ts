// Tx 10: UpdateOwnerInfo — owner updates mutable profile fields.
// Spends Owner NFT UTxO (owners_spend, UpdateOwnerInfo redeemer).
// Returns it to OWNERS_VALIDATOR_ADDR with updated datum (stats unchanged).

import { useState } from 'react'
import { Data, Constr, applyParamsToScript, fromText } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  OWNERS_VALIDATOR_ADDR,
  OWNER_NFT_POLICY,
  COMPANY_PKH,
  OWNERS_SPEND_COMPILED,
  RENT_VALIDATOR_HASH,
} from '../lib/config'
import { getAddressUtxos } from '../lib/blockfrost'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'
import type { MutableOwnerFields } from '../components/OwnerInfoForm'

const appliedOwnersSpend = applyParamsToScript(OWNERS_SPEND_COMPILED, [
  new Constr(0, [COMPANY_PKH, OWNER_NFT_POLICY, RENT_VALIDATOR_HASH])
])

export function useUpdateOwnerInfo() {
  const { lucid, pkh: ownerPkh } = useLucid()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const updateOwnerInfo = async (patch: MutableOwnerFields, ownerNFTName: string): Promise<string> => {
    if (!lucid) throw new Error('Wallet no conectada')

    setLoading(true)
    setError(null)

    try {
      const fieldNftUnit = OWNER_NFT_POLICY + ownerNFTName
      const ownerUtxos = await getAddressUtxos(OWNERS_VALIDATOR_ADDR)

      // G: stats UTxO has no NFT — find by ownerNFTName in datum (field 0 of inner Constr)
      const ownerStatsRaw = ownerUtxos.find(u => {
        if (!u.inline_datum) return false
        if (u.amount.some(a => a.unit === fieldNftUnit)) return false
        try {
          const raw = Data.from(u.inline_datum) as Constr<Data>
          if (Number(raw.index) !== 1) return false
          const inner = raw.fields[0] as Constr<Data>
          return (inner.fields[0] as string) === ownerNFTName
        } catch { return false }
      })
      if (!ownerStatsRaw) throw new Error('Stats UTxO del propietario no encontrado en el contrato')
      if (!ownerStatsRaw.inline_datum) throw new Error('Stats UTxO sin inline datum')

      // G: find this field's NFT in owner's wallet
      const walletAddr = await lucid.wallet().address()
      const walletUtxos = await lucid.wallet().getUtxos()
      const nftWalletUtxo = walletUtxos.find(u => (u.assets[fieldNftUnit] ?? 0n) >= 1n)
      if (!nftWalletUtxo) throw new Error('Owner NFT no encontrado en tu wallet')

      // Parse raw Constr — DatumOwner = Constr(1, [OwnerRecord = Constr(0, [fields...])])
      const raw = Data.from(ownerStatsRaw.inline_datum) as Constr<Data>
      const innerRecord = raw.fields[0] as Constr<Data>

      // Rebuild preserving all fields; only replace indices 6-12 (mutable profile) + 15 (timezone)
      const fields = [...innerRecord.fields]
      fields[6]  = fromText(patch.fieldName)
      fields[7]  = fromText(patch.address)
      fields[8]  = fromText(patch.phone)
      fields[9]  = fromText(patch.email)
      fields[10] = fromText(patch.lat)
      fields[11] = fromText(patch.long)
      fields[12] = fromText(patch.paymentAddress)
      fields[15] = fromText(patch.timezone)
      // field 13 (guaranteePerSlot) preserved as-is from innerRecord.fields[13]

      const updatedDatum = Data.to(
        new Constr(Number(raw.index), [
          new Constr(Number(innerRecord.index), fields)
        ])
      )

      const ownerLovelace = BigInt(
        ownerStatsRaw.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0'
      )

      const redeemer = Data.to(new Constr(2, []))  // UpdateOwnerInfo = index 2

      const tx = await lucid.newTx()
        .collectFrom(
          [{
            txHash: ownerStatsRaw.tx_hash,
            outputIndex: ownerStatsRaw.output_index,
            address: OWNERS_VALIDATOR_ADDR,
            assets: { lovelace: ownerLovelace },  // G: no NFT in stats UTxO
            datum: ownerStatsRaw.inline_datum,
          }],
          redeemer,
        )
        .attach.SpendingValidator({ type: 'PlutusV3', script: appliedOwnersSpend })
        .pay.ToContract(
          OWNERS_VALIDATOR_ADDR,
          { kind: 'inline', value: updatedDatum },
          { lovelace: ownerLovelace },  // G: no NFT in continuing output
        )
        // G: NFT pass-through — return to wallet (proves NFT ownership on-chain)
        .pay.ToAddress(walletAddr, { lovelace: nftWalletUtxo.assets.lovelace, [fieldNftUnit]: 1n })
        .addSignerKey(ownerPkh)
        .complete()

      const signed = await tx.sign.withWallet().complete()
      return await signed.submit()
    } catch (e: unknown) {
      const msg = unwrapSubmitError(e)
      setError(msg)
      throw new Error(msg)
    } finally {
      setLoading(false)
    }
  }

  return { updateOwnerInfo, loading, error }
}
