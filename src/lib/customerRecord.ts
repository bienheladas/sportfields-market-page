// CustomerRecord — per (customer, cancha) stats living at owners_spend
// (OwnersDatum index 2). One record per cancha a customer has interacted
// with, never a single global record per customer, so customers never
// compete with each other (or with their own activity at other canchas) to
// spend the same UTxO. See CLAUDE.md "CustomerRecord".
//
// Unlike OwnerRecord, creating the FIRST record needs no redeemer at all: a
// fresh DatumCustomer output can be paid to the script with no corresponding
// input, since Plutus validators only gate spending, never receiving.
// UpdateCustomerRecord (redeemer index 8) is only used when an EXISTING
// record is being spent-and-recreated with one counter incremented by 1.

import { Data, Constr } from '@lucid-evolution/lucid'
import { getAddressUtxos, type BlockfrostUtxo } from './blockfrost'
import { OWNERS_VALIDATOR_ADDR } from './config'
import { decodeOwnersDatum } from './decoders'

export type CustomerStatKind = 'RentalCompleted' | 'RentalCancelled' | 'DisputeWon' | 'DisputeLost'

const KIND_INDEX: Record<CustomerStatKind, number> = {
  RentalCompleted: 0,
  RentalCancelled: 1,
  DisputeWon: 2,
  DisputeLost: 3,
}

// Index within the inner CustomerRecord Constr's fields array (0=customerPkh,
// 1=ownerNFTName, 2=rentalsCompleted, 3=rentalsCancelled, 4=disputesWon, 5=disputesLost).
const KIND_FIELD_INDEX: Record<CustomerStatKind, number> = {
  RentalCompleted: 2,
  RentalCancelled: 3,
  DisputeWon: 4,
  DisputeLost: 5,
}

export const CUSTOMER_RECORD_MIN_LOVELACE = 2_000_000n

export function updateCustomerRecordRedeemer(kind: CustomerStatKind): string {
  return Data.to(new Constr(8, [new Constr(KIND_INDEX[kind], [])]))
}

/** Finds the existing CustomerRecord for (customerPkh, ownerNFTName), if any. */
export async function findCustomerRecordUtxo(
  customerPkh: string,
  ownerNFTName: string,
): Promise<BlockfrostUtxo | null> {
  const ownersUtxos = await getAddressUtxos(OWNERS_VALIDATOR_ADDR)
  const found = ownersUtxos.find(u => {
    if (!u.inline_datum) return false
    try {
      const d = decodeOwnersDatum(u.inline_datum)
      return d.kind === 'Customer' &&
        d.record.customerPkh === customerPkh &&
        d.record.ownerNFTName === ownerNFTName
    } catch { return false }
  })
  return found ?? null
}

/** Builds a brand-new CustomerRecord datum (first interaction with this cancha). */
export function initialCustomerRecordDatum(
  customerPkh: string,
  ownerNFTName: string,
  kind: CustomerStatKind,
): string {
  const counters = [0n, 0n, 0n, 0n]
  counters[KIND_FIELD_INDEX[kind] - 2] = 1n
  return Data.to(new Constr(2, [new Constr(0, [customerPkh, ownerNFTName, ...counters])]))
}

/** Rebuilds an existing CustomerRecord datum with one counter bumped by 1. */
export function bumpedCustomerRecordDatum(rawDatumHex: string, kind: CustomerStatKind): string {
  const outer = Data.from(rawDatumHex) as Constr<Data>
  const inner = outer.fields[0] as Constr<Data>
  const fields = [...inner.fields]
  const idx = KIND_FIELD_INDEX[kind]
  fields[idx] = (fields[idx] as bigint) + 1n
  return Data.to(new Constr(2, [new Constr(0, fields)]))
}
