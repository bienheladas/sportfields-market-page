// CBOR → TS type decoders for on-chain datums.
// Uses the same cbor tag conventions as plutus-cbor.mjs.

import type { RentDatum, OwnerRecord, CompanyConfig, OwnersDatum, SlotStatus } from '../components/types'
import { SLOT_STATUS_BY_TAG } from '../components/types'
import { bech32 } from 'bech32'

// We decode inline_datum hex (already CBOR) using the browser's native capabilities
// via a lightweight CBOR reader.  For now we delegate to a tiny hand-rolled decoder
// since the browser has no native CBOR support.

function readCborHex(hex: string): CborValue {
  const bytes = hexToBytes(hex)
  const [value] = decodeCbor(bytes, 0)
  return value
}

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < arr.length; i++)
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return arr
}

interface CborMap { _cborMap: true; entries: [CborValue, CborValue][] }
type CborValue = number | bigint | Uint8Array | CborValue[] | { tag: number; value: CborValue } | CborMap

function isCborMap(v: CborValue): v is CborMap {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array) && '_cborMap' in v
}

function decodeCbor(buf: Uint8Array, offset: number): [CborValue, number] {
  const first = buf[offset]
  const major = first >> 5
  const info  = first & 0x1f
  offset++

  function readUint(info: number): [bigint, number] {
    if (info <= 23) return [BigInt(info), offset]
    if (info === 24) return [BigInt(buf[offset]), offset + 1]
    if (info === 25) {
      const v = (buf[offset] << 8) | buf[offset + 1]
      return [BigInt(v), offset + 2]
    }
    if (info === 26) {
      const v = ((buf[offset] << 24) | (buf[offset+1] << 16) | (buf[offset+2] << 8) | buf[offset+3]) >>> 0
      return [BigInt(v), offset + 4]
    }
    // 27 = 8-byte uint
    let v = 0n
    for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(buf[offset + i])
    return [v, offset + 8]
  }

  if (major === 0) { // unsigned int
    const [n, o] = readUint(info)
    return [n, o]
  }
  if (major === 1) { // negative int
    const [n, o] = readUint(info)
    return [-1n - n, o]
  }
  if (major === 2) { // bytes
    const [len, o] = readUint(info)
    const end = o + Number(len)
    return [buf.slice(o, end), end]
  }
  if (major === 3) { // text
    const [len, o] = readUint(info)
    const end = o + Number(len)
    return [buf.slice(o, end), end]  // return as bytes, caller decodes UTF-8
  }
  if (major === 4) { // array
    if (info === 31) { // indefinite-length
      let cur = offset
      const items: CborValue[] = []
      while (buf[cur] !== 0xff) {
        const [v, next] = decodeCbor(buf, cur)
        items.push(v)
        cur = next
      }
      return [items, cur + 1]
    }
    const [len, o] = readUint(info)
    let cur = o
    const items: CborValue[] = []
    for (let i = 0; i < Number(len); i++) {
      const [v, next] = decodeCbor(buf, cur)
      items.push(v)
      cur = next
    }
    return [items, cur]
  }
  if (major === 5) { // map
    const entries: [CborValue, CborValue][] = []
    if (info === 31) { // indefinite-length
      let cur = offset
      while (buf[cur] !== 0xff) {
        const [k, nk] = decodeCbor(buf, cur)
        const [v, nv] = decodeCbor(buf, nk)
        entries.push([k, v])
        cur = nv
      }
      return [{ _cborMap: true, entries }, cur + 1]
    }
    const [len, o] = readUint(info)
    let cur = o
    for (let i = 0; i < Number(len); i++) {
      const [k, nk] = decodeCbor(buf, cur)
      const [v, nv] = decodeCbor(buf, nk)
      entries.push([k, v])
      cur = nv
    }
    return [{ _cborMap: true, entries }, cur]
  }
  if (major === 6) { // tag
    const [tagNum, o] = readUint(info)
    const [value, end] = decodeCbor(buf, o)
    return [{ tag: Number(tagNum), value }, end]
  }
  throw new Error(`Unsupported CBOR major type ${major} at offset ${offset - 1}`)
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
}

function bytesToUtf8(b: Uint8Array): string {
  return new TextDecoder().decode(b)
}

function asBytes(v: CborValue): Uint8Array {
  if (v instanceof Uint8Array) return v
  throw new Error('Expected bytes, got ' + typeof v)
}

function asInt(v: CborValue): bigint {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') return BigInt(v)
  throw new Error('Expected int')
}

function asTag(v: CborValue, expectedTag?: number): { tag: number; value: CborValue } {
  if (typeof v !== 'object' || v instanceof Uint8Array || Array.isArray(v))
    throw new Error('Expected tag')
  const t = v as { tag: number; value: CborValue }
  if (expectedTag !== undefined && t.tag !== expectedTag)
    throw new Error(`Expected tag ${expectedTag}, got ${t.tag}`)
  return t
}

function asArray(v: CborValue): CborValue[] {
  const arr = Array.isArray(v) ? v : (asTag(v).value as CborValue[])
  if (!Array.isArray(arr)) throw new Error('Expected array')
  return arr
}

// SlotStatus: Available=0(121) Pending=1(122) Confirmed=2(123) Completed=3(124) Refunded=4(125) Disputed=5(126)
function decodeSlotStatus(v: CborValue): SlotStatus {
  const t = asTag(v)
  const idx = t.tag - 121
  const status = SLOT_STATUS_BY_TAG[idx]
  if (!status) throw new Error(`Unknown SlotStatus tag ${t.tag}`)
  return status
}

// Maybe: Just x = Tag121[x], Nothing = Tag122[]
function decodeMaybe<T>(v: CborValue, decoder: (v: CborValue) => T): T | null {
  const t = asTag(v)
  if (t.tag === 122) return null
  if (t.tag === 121) return decoder(asArray(t.value)[0])
  throw new Error(`Expected Maybe tag 121/122, got ${t.tag}`)
}

export function decodeRentDatum(hex: string): RentDatum {
  const outer = asTag(readCborHex(hex), 121)  // Constr 0
  const fields = asArray(outer.value)

  return {
    slotId:           Number(asInt(fields[0])),
    slotStart:        Number(asInt(fields[1])),
    slotEnd:          Number(asInt(fields[2])),
    cancelDeadline:   Number(asInt(fields[3])),
    rentPrice:        asInt(fields[4]),
    siteCommissionBps: Number(asInt(fields[5])),
    ownerNFTName:     bytesToHex(asBytes(fields[6])),
    ownerPkh:         bytesToHex(asBytes(fields[7])),
    companyPkh:       bytesToHex(asBytes(fields[8])),
    status:           decodeSlotStatus(fields[9]),
    customerPkh:      decodeMaybe(fields[10], v => bytesToHex(asBytes(v))),
    rentNFTName:      decodeMaybe(fields[11], v => bytesToHex(asBytes(v))),
    disputeDeposit:   decodeMaybe(fields[12], v => asInt(v)),
    fieldName:        bytesToHex(asBytes(fields[13])),
    fieldAddress:     bytesToHex(asBytes(fields[14])),
    phone:            bytesToHex(asBytes(fields[15])),
    email:            bytesToHex(asBytes(fields[16])),
    lat:              bytesToHex(asBytes(fields[17])),
    long:             bytesToHex(asBytes(fields[18])),
    paymentAddress:   bytesToHex(asBytes(fields[19])),
  }
}

export function decodeOwnersDatum(hex: string): OwnersDatum {
  const outer = asTag(readCborHex(hex))

  if (outer.tag === 121) {
    // DatumCompany (index 0) — outer.value is array([innerConstr])
    const inner = asTag(asArray(outer.value)[0], 121)
    const f = asArray(inner.value)
    const config: CompanyConfig = {
      siteCommissionBps: Number(asInt(f[0])),
      disputeFee:        asInt(f[1]),
      registrationFee:   asInt(f[2]),
      collateral:        asInt(f[3]),
      maxDisputeLosses:  Number(asInt(f[4])),
      companyPkh:        bytesToHex(asBytes(f[5])),
    }
    return { kind: 'Company', config }
  }

  if (outer.tag === 122) {
    // DatumOwner (index 1) — outer.value is array([innerConstr])
    const inner = asTag(asArray(outer.value)[0], 121)
    const f = asArray(inner.value)
    const record: OwnerRecord = {
      ownerNFTName:      bytesToHex(asBytes(f[0])),
      ownerPkh:          bytesToHex(asBytes(f[1])),
      rentalsCompleted:  Number(asInt(f[2])),
      rentalsRefunded:   Number(asInt(f[3])),
      rentalsDisputed:   Number(asInt(f[4])),
      rentNFTsProven:    Number(asInt(f[5])),
      fieldName:         bytesToHex(asBytes(f[6])),
      address:           bytesToHex(asBytes(f[7])),
      phone:             bytesToHex(asBytes(f[8])),
      email:             bytesToHex(asBytes(f[9])),
      lat:               bytesToHex(asBytes(f[10])),
      long:              bytesToHex(asBytes(f[11])),
      paymentAddress:    bytesToHex(asBytes(f[12])),
    }
    return { kind: 'Owner', record }
  }

  throw new Error(`Unknown OwnersDatum tag ${outer.tag}`)
}

export { bytesToUtf8 }

// CIP-19 address bytes → bech32 (Shelley base/enterprise/reward/pointer)
function addrBytesToBech32(addrBytes: Uint8Array): string {
  const networkId = addrBytes[0] & 0x0f
  const hrp = networkId === 1 ? 'addr' : 'addr_test'
  const words = bech32.toWords(addrBytes)
  return bech32.encode(hrp, words, 1000)
}

// Convert a raw CIP-19 hex address to bech32. No-op if already bech32.
export function normalizeAddress(addr: string): string {
  if (addr.startsWith('addr')) return addr
  try {
    return addrBytesToBech32(hexToBytes(addr))
  } catch {
    return addr
  }
}

// ── CIP-30 raw UTxO normalizer ─────────────────────────────────────────────
// Mesh SDK beta may return wallet.getUtxos() as raw CIP-30 CBOR hex strings
// instead of parsed objects. This converts either format to a consistent shape.

export interface ParsedUtxo {
  input: { txHash: string; outputIndex: number }
  output: { address: string; amount: { unit: string; quantity: string }[] }
}

export function normalizeMeshUtxos(raw: unknown[]): ParsedUtxo[] {
  const result: ParsedUtxo[] = []
  for (const u of raw) {
    if (typeof u !== 'string') {
      if (u && typeof u === 'object') result.push(u as ParsedUtxo)
      continue
    }
    try {
      const bytes = hexToBytes(u)
      const [outer] = decodeCbor(bytes, 0)
      if (!Array.isArray(outer) || outer.length < 2) continue

      const inp = outer[0]
      const out = outer[1]
      if (!Array.isArray(inp) || !Array.isArray(out)) continue

      const txHash      = bytesToHex(asBytes(inp[0]))
      const outputIndex = Number(asInt(inp[1]))
      const addrBytes   = asBytes(out[0])
      const address     = addrBytesToBech32(addrBytes)
      const value       = out[1]

      // Value: uint (pure ADA) | [lovelace, multiasset_map] (with tokens)
      const amount: { unit: string; quantity: string }[] = []
      let lovelace: bigint
      if (typeof value === 'bigint' || typeof value === 'number') {
        lovelace = BigInt(value)
      } else if (Array.isArray(value) && value.length >= 2) {
        lovelace = asInt(value[0])
        // Decode each policy → asset → quantity from the multiasset map
        const maValue = value[1]
        if (isCborMap(maValue)) {
          for (const [policyVal, assetMapVal] of maValue.entries) {
            if (!(policyVal instanceof Uint8Array)) continue
            const policyId = bytesToHex(policyVal)
            if (!isCborMap(assetMapVal)) continue
            for (const [assetNameVal, qtyVal] of assetMapVal.entries) {
              if (!(assetNameVal instanceof Uint8Array)) continue
              const assetName = bytesToHex(assetNameVal)
              amount.push({ unit: policyId + assetName, quantity: String(asInt(qtyVal)) })
            }
          }
        }
        if (amount.length === 0) {
          // Fallback sentinel so collateral filter still excludes non-pure UTxOs
          amount.push({ unit: 'multiasset', quantity: '1' })
        }
      } else {
        continue
      }
      amount.unshift({ unit: 'lovelace', quantity: String(lovelace) })

      result.push({ input: { txHash, outputIndex }, output: { address, amount } })
    } catch { /* skip malformed */ }
  }
  return result
}
