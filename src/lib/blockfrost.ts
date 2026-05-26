import axios from 'axios'
import { BLOCKFROST_KEY, BLOCKFROST_URL } from './config'

const bf = axios.create({
  baseURL: BLOCKFROST_URL,
  headers: { project_id: BLOCKFROST_KEY },
})

export async function getAddressUtxos(address: string): Promise<BlockfrostUtxo[]> {
  const all: BlockfrostUtxo[] = []
  let page = 1
  while (true) {
    const res = await bf.get(`/addresses/${address}/utxos`, {
      params: { count: 100, page },
    })
    const batch = res.data as BlockfrostUtxo[]
    all.push(...batch)
    if (batch.length < 100) break
    page++
  }
  return all
}

export async function getLatestEpochParams() {
  const res = await bf.get('/epochs/latest/parameters')
  return res.data
}

export interface BlockfrostUtxo {
  tx_hash: string
  output_index: number
  amount: { unit: string; quantity: string }[]
  inline_datum: string | null
  reference_script_hash: string | null
  data_hash: string | null
}
