// Browser port of the fixScriptDataHash helper from rent-slot.mjs.
// Uses @cardano-sdk/core (transitive dep) and blake2b (transitive dep).
// Buffer is available via vite-plugin-node-polyfills.

import { Serialization, Cardano } from '@cardano-sdk/core'
import { Hash32ByteBase16 } from '@cardano-sdk/crypto'
import blake2b from 'blake2b'
import axios from 'axios'
import { BLOCKFROST_KEY, BLOCKFROST_URL } from './config'

export interface SlotUtxoForEval {
  tx_hash: string
  output_index: number
  amount: { unit: string; quantity: string }[]
  inline_datum: string
  address: string
}

export interface MeshUtxo {
  input: { txHash: string; outputIndex: number }
  output: { address: string; amount: { unit: string; quantity: string }[] }
}

const TAG_NAMES = ['spend', 'mint', 'cert', 'reward', 'vote', 'propose']
const MARGIN        = 1.2
const DUMMY_STEPS   = 10_000_000_000n
const DUMMY_MEM     = 14_000_000n
const FALLBACK_STEPS = 4_000_000_000n
const FALLBACK_MEM   = 6_000_000n

export async function fixScriptDataHash(
  unsignedTxHex: string,
  slotUtxo: SlotUtxoForEval | null,
  collateralUtxo: MeshUtxo,
): Promise<string> {
  const tx         = Serialization.Transaction.fromCbor(Serialization.TxCBOR(unsignedTxHex))
  const txBody     = tx.body()
  const witnessSet = tx.witnessSet()
  const redeemers  = witnessSet.redeemers()
  if (!redeemers || redeemers.size() === 0) return unsignedTxHex

  // 1 — set total_collateral so Blockfrost evaluate/utxos accepts the tx
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collateralAmount: { unit: string; quantity: string }[] =
    (collateralUtxo as any)?.output?.amount ?? (collateralUtxo as any)?.amount ?? []
  const collateralAda = BigInt(collateralAmount[0]?.quantity ?? '5000000')
  txBody.setTotalCollateral(collateralAda)
  tx.setBody(txBody)
  const txHexForEval = String(tx.toCbor())

  // 2 — protocol params for fee calculation and cost models
  const paramsResp = await axios.get(`${BLOCKFROST_URL}/epochs/latest/parameters`, {
    headers: { project_id: BLOCKFROST_KEY },
  })
  const params   = paramsResp.data
  const v3Obj    = params.cost_models?.PlutusV3
  if (!v3Obj) throw new Error('No cost_models.PlutusV3 from Blockfrost')
  const v3Array  = (Object.values(v3Obj) as number[]).map(Number)
  const priceStep = Number(params.price_step)
  const priceMem  = Number(params.price_mem)

  // 3 — evaluate ExUnits
  type ExMap = Record<string, { steps: string | number; memory: string | number }>
  let realExUnitsMap: ExMap = {}

  try {
    if (slotUtxo) {
      // Spending a script UTxO — describe the input so the evaluator knows it
      const evalResp = await axios.post(
        `${BLOCKFROST_URL}/utils/txs/evaluate/utxos`,
        {
          cbor: txHexForEval,
          additionalUtxoSet: [{
            tx_hash:               slotUtxo.tx_hash,
            tx_index:              slotUtxo.output_index,
            amount:                slotUtxo.amount,
            address:               slotUtxo.address,
            data_hash:             null,
            inline_datum:          slotUtxo.inline_datum,
            reference_script_hash: null,
          }],
        },
        { headers: { project_id: BLOCKFROST_KEY } },
      )
      const failures = evalResp.data?.result?.EvaluationFailure?.ScriptFailures
                    ?? evalResp.data?.EvaluationFailure?.ScriptFailures
      if (failures && Object.keys(failures).length > 0)
        throw new Error(`Script failure during evaluate: ${JSON.stringify(failures)}`)
      realExUnitsMap = evalResp.data?.result?.EvaluationResult
                    ?? evalResp.data?.EvaluationResult
                    ?? {}
    } else {
      // Mint-only — no script UTxO consumed; use evaluate/utxos with empty set
      // (avoids sending raw binary in the browser, same JSON format as spending path)
      const evalResp = await axios.post(
        `${BLOCKFROST_URL}/utils/txs/evaluate/utxos`,
        { cbor: txHexForEval, additionalUtxoSet: [] },
        { headers: { project_id: BLOCKFROST_KEY } },
      )
      const failures = evalResp.data?.result?.EvaluationFailure?.ScriptFailures
                    ?? evalResp.data?.EvaluationFailure?.ScriptFailures
      if (failures && Object.keys(failures).length > 0)
        throw new Error(`Script failure during evaluate: ${JSON.stringify(failures)}`)
      realExUnitsMap = evalResp.data?.result?.EvaluationResult
                    ?? evalResp.data?.EvaluationResult
                    ?? {}
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.startsWith('Script failure')) throw e
    console.warn('evaluate failed, using fallback ExUnits:', msg)
  }

  // 4 — bump ExUnits and update redeemers
  let totalDeltaSteps = 0n
  let totalDeltaMem   = 0n

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bumpedList = (redeemers.values() as any[]).map((r: any) => {
    const purposeKey = `${TAG_NAMES[Number(r.tag())] ?? 'spend'}:${r.index()}`
    const eu         = realExUnitsMap[purposeKey]
    const realSteps  = eu ? BigInt(eu.steps)  : FALLBACK_STEPS
    const realMem    = eu ? BigInt(eu.memory) : FALLBACK_MEM
    const bSteps     = BigInt(Math.ceil(Number(realSteps) * MARGIN))
    const bMem       = BigInt(Math.ceil(Number(realMem)   * MARGIN))
    totalDeltaSteps += bSteps - DUMMY_STEPS
    totalDeltaMem   += bMem   - DUMMY_MEM
    return new Serialization.Redeemer(
      r.tag(), r.index(), r.data(),
      new Serialization.ExUnits(bMem, bSteps),
    )
  })

  redeemers.setValues(bumpedList)
  witnessSet.setRedeemers(redeemers)
  tx.setWitnessSet(witnessSet)

  // 5 — recompute script data hash
  const costModels    = Serialization.Costmdls.fromCore(
    new Map([[Cardano.PlutusLanguageVersion.V3, v3Array]]),
  )
  const redeemerBytes = Buffer.from(redeemers.toCbor(), 'hex')
  const langViewBytes = Buffer.from(costModels.languageViewsEncoding(), 'hex')
  const plutusData    = witnessSet.plutusData()
  const parts = (plutusData && plutusData.size() > 0)
    ? [redeemerBytes, Buffer.from(plutusData.toCbor(), 'hex'), langViewBytes]
    : [redeemerBytes, langViewBytes]

  const hashHex = Buffer.from(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (blake2b as any)(32).update(Buffer.concat(parts)).digest(),
  ).toString('hex')
  txBody.setScriptDataHash(Hash32ByteBase16(hashHex))

  // 6 — adjust fee
  const deltaFee         = BigInt(Math.ceil(Number(totalDeltaSteps) * priceStep + Number(totalDeltaMem) * priceMem))
  const sizeGrowthBytes  = BigInt(Math.max(0, (txHexForEval.length - unsignedTxHex.length) / 2))
  const totalFeeIncrease = deltaFee + sizeGrowthBytes * 44n + 200n
  const newFee           = txBody.fee() + totalFeeIncrease
  txBody.setFee(newFee)

  // 7 — subtract fee increase from change output (largest non-datum output)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outputs: any[]      = txBody.outputs()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nonDatumItems       = outputs.map((o: any, i: number) => ({ o, i })).filter(({ o }: any) => !o.datum())
  const changeEntry         = nonDatumItems.reduce(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (best: any, curr: any) => (!best || curr.o.amount().coin() > best.o.amount().coin()) ? curr : best,
    null,
  )
  if (!changeEntry) throw new Error('No change output found in transaction')

  const changeOut  = outputs[changeEntry.i]
  const newCoin    = changeOut.amount().coin() - totalFeeIncrease
  if (newCoin < 1_000_000n) throw new Error(`Change output too small after fee adjustment: ${newCoin}`)
  const maValue    = changeOut.amount().multiasset()
  const finalValue = maValue
    ? new Serialization.Value(newCoin, maValue)
    : new Serialization.Value(newCoin)
  outputs[changeEntry.i] = new Serialization.TransactionOutput(changeOut.address(), finalValue)
  txBody.setOutputs(outputs)

  tx.setBody(txBody)
  return String(tx.toCbor())
}
