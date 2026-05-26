// Browser-compatible port of off-chain/plutus-cbor.mjs.
// Buffer is available via vite-plugin-node-polyfills.

function encodeUint(n: bigint): Buffer {
  if (n < 24n)          return Buffer.from([Number(n)])
  if (n < 0x100n)       return Buffer.from([0x18, Number(n)])
  if (n < 0x10000n)     { const b = Buffer.alloc(3);  b[0] = 0x19; b.writeUInt16BE(Number(n), 1); return b }
  if (n < 0x100000000n) { const b = Buffer.alloc(5);  b[0] = 0x1a; b.writeUInt32BE(Number(n), 1); return b }
                        { const b = Buffer.alloc(9);  b[0] = 0x1b; b.writeBigUInt64BE(n, 1);       return b }
}

function encodeArray(items: Buffer[]): Buffer {
  const hdr = encodeUint(BigInt(items.length))
  hdr[0] |= 0x80
  return Buffer.concat([hdr, ...items])
}

function encodeTag(tagNum: number): Buffer {
  if (tagNum < 24)  return Buffer.from([0xc0 | tagNum])
  if (tagNum < 256) return Buffer.from([0xd8, tagNum])
  const b = Buffer.alloc(3); b[0] = 0xd9; b.writeUInt16BE(tagNum, 1); return b
}

export function pInt(n: number | bigint): Buffer {
  const bi = BigInt(n)
  if (bi >= 0n) return encodeUint(bi)
  const m = encodeUint(-1n - bi)
  m[0] |= 0x20
  return m
}

export function pBytes(buf: Buffer | Uint8Array): Buffer {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  const hdr = encodeUint(BigInt(b.length))
  hdr[0] |= 0x40
  return Buffer.concat([hdr, b])
}

export function pConstr(alt: number, fields: Buffer[]): Buffer {
  if (alt <= 6) {
    return Buffer.concat([encodeTag(121 + alt), encodeArray(fields)])
  }
  return Buffer.concat([
    encodeTag(102),
    encodeArray([encodeUint(BigInt(alt)), encodeArray(fields)])
  ])
}

export const pAvailable  = (): Buffer => pConstr(0, [])
export const pPending    = (): Buffer => pConstr(1, [])
export const pConfirmed  = (): Buffer => pConstr(2, [])
export const pCompleted  = (): Buffer => pConstr(3, [])
export const pNothing    = (): Buffer => pConstr(1, [])
export const pJust       = (field: Buffer): Buffer => pConstr(0, [field])
export const pRefunded   = (): Buffer => pConstr(4, [])
export const pDisputed   = (): Buffer => pConstr(5, [])

export interface OwnerDatumFields {
  /** 28 bytes — also the Owner NFT token name */
  ownerPkh: Buffer;
  fieldName: Buffer;
  fieldAddress: Buffer;
  phone: Buffer;
  email: Buffer;
  lat: Buffer;
  long_: Buffer;
}

export function buildOwnerDatumHex(d: OwnerDatumFields): string {
  const ownerRecord = pConstr(0, [
    pBytes(d.ownerPkh),       // 0  orOwnerNFTName    (= PKH, token name)
    pBytes(d.ownerPkh),       // 1  orOwnerPkh
    pInt(0),                  // 2  orRentalsCompleted
    pInt(0),                  // 3  orRentalsRefunded
    pInt(0),                  // 4  orRentalsDisputed
    pInt(0),                  // 5  orRentNFTsProven
    pBytes(d.fieldName),      // 6  orFieldName
    pBytes(d.fieldAddress),   // 7  orAddress
    pBytes(d.phone),          // 8  orPhone
    pBytes(d.email),          // 9  orEmail
    pBytes(d.lat),            // 10 orLat
    pBytes(d.long_),          // 11 orLong
    pBytes(d.ownerPkh),       // 12 orPaymentAddress (PKH raw, < 64 bytes)
  ])
  return pConstr(1, [ownerRecord]).toString('hex')
}

export interface RentDatumFields {
  slotId: number;
  slotStart: number;
  slotEnd: number;
  cancelDeadline: number;
  rentPrice: number;
  commissionBps: number;
  ownerNFTName: Buffer;
  ownerPkh: Buffer;
  companyPkh: Buffer;
  status: Buffer;
  customerPkh: Buffer;
  rentNFTName: Buffer;
  disputeDeposit: Buffer;
  fieldName: Buffer;
  fieldAddress: Buffer;
  phone: Buffer;
  email: Buffer;
  lat: Buffer;
  long_: Buffer;
  paymentAddress: Buffer;
}

export function buildRentDatumHex(d: RentDatumFields): string {
  return pConstr(0, [
    pInt(d.slotId),
    pInt(d.slotStart),
    pInt(d.slotEnd),
    pInt(d.cancelDeadline),
    pInt(d.rentPrice),
    pInt(d.commissionBps),
    pBytes(d.ownerNFTName),
    pBytes(d.ownerPkh),
    pBytes(d.companyPkh),
    d.status,
    d.customerPkh,
    d.rentNFTName,
    d.disputeDeposit,
    pBytes(d.fieldName),
    pBytes(d.fieldAddress),
    pBytes(d.phone),
    pBytes(d.email),
    pBytes(d.lat),
    pBytes(d.long_),
    pBytes(d.paymentAddress),
  ]).toString('hex')
}
