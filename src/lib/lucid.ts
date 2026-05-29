import { Lucid, Blockfrost } from '@lucid-evolution/lucid'
import { BLOCKFROST_KEY, BLOCKFROST_URL } from './config'

type LucidInstance = Awaited<ReturnType<typeof Lucid>>

let _lucid: LucidInstance | null = null

export async function getLucid(): Promise<LucidInstance> {
  if (!_lucid) {
    _lucid = await Lucid(new Blockfrost(BLOCKFROST_URL, BLOCKFROST_KEY), 'Preview')
  }
  return _lucid
}
