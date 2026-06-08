// Patch CML.TransactionMetadatum.from_json to use native CML API.
// The browser WASM from_json fails with {list:[...]} inside nested maps.
// This patch builds the metadatum tree directly using new_text/new_list/new_map.

import { CML } from '@lucid-evolution/lucid'

type MetaJson =
  | { string: string }
  | { int: number }
  | { bytes: string }
  | { list: MetaJson[] }
  | { map: { k: MetaJson; v: MetaJson }[] }

function buildMetadatum(j: MetaJson): CML.TransactionMetadatum {
  if ('string' in j) {
    return CML.TransactionMetadatum.new_text(j.string)
  }
  if ('int' in j) {
    return CML.TransactionMetadatum.new_int(CML.Int.from_str(String(j.int)))
  }
  if ('bytes' in j) {
    const hex = j.bytes
    const bytes = new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
    return CML.TransactionMetadatum.new_bytes(bytes)
  }
  if ('list' in j) {
    const list = CML.MetadatumList.new()
    for (const item of j.list) list.add(buildMetadatum(item))
    return CML.TransactionMetadatum.new_list(list)
  }
  if ('map' in j) {
    const map = CML.MetadatumMap.new()
    for (const { k, v } of j.map) map.set(buildMetadatum(k), buildMetadatum(v))
    return CML.TransactionMetadatum.new_map(map)
  }
  throw new Error('patchCmlFromJson: unknown metadatum shape')
}

let patched = false
export function patchCmlFromJson() {
  if (patched) return
  patched = true
  const proto = CML.TransactionMetadatum as unknown as {
    from_json: (json: string) => CML.TransactionMetadatum
  }
  proto.from_json = (json: string) => buildMetadatum(JSON.parse(json) as MetaJson)
}
