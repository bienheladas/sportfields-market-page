// Reference script UTxOs deployed once via deploy-scripts.mjs (owner's wallet).
// Use .readFrom([...]) with these instead of .attach.SpendingValidator/MintingPolicy
// whenever a tx needs 2+ of {rent_spend, owners_spend, rent_minting_policy} —
// the compiled scripts combined exceed Cardano's 16.384-byte tx size limit.

import type { LucidEvolution, UTxO } from '@lucid-evolution/lucid'
import {
  RENT_SPEND_REF_TXHASH, RENT_SPEND_REF_INDEX,
  OWNERS_SPEND_REF_TXHASH, OWNERS_SPEND_REF_INDEX,
  RENT_MINT_REF_TXHASH, RENT_MINT_REF_INDEX,
} from './config'

export async function getRentSpendRefUtxo(lucid: LucidEvolution): Promise<UTxO> {
  const [u] = await lucid.utxosByOutRef([{ txHash: RENT_SPEND_REF_TXHASH, outputIndex: RENT_SPEND_REF_INDEX }])
  if (!u) throw new Error('Reference script rent_spend no encontrado on-chain')
  return u
}

export async function getOwnersSpendRefUtxo(lucid: LucidEvolution): Promise<UTxO> {
  const [u] = await lucid.utxosByOutRef([{ txHash: OWNERS_SPEND_REF_TXHASH, outputIndex: OWNERS_SPEND_REF_INDEX }])
  if (!u) throw new Error('Reference script owners_spend no encontrado on-chain')
  return u
}

export async function getRentMintRefUtxo(lucid: LucidEvolution): Promise<UTxO> {
  const [u] = await lucid.utxosByOutRef([{ txHash: RENT_MINT_REF_TXHASH, outputIndex: RENT_MINT_REF_INDEX }])
  if (!u) throw new Error('Reference script rent_minting_policy no encontrado on-chain')
  return u
}
