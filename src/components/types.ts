// react/types.ts
// Plutus V3 datum & redeemer types — mirrors the Haskell definitions in
// OwnersValidator.hs, OwnersMintingPolicy.hs, RentValidator.hs, RentMintingPolicy.hs.
//
// Conversions from PlutusData (CBOR) → these TS types happen in your decoder
// layer (e.g. Mesh / Lucid). These types are the *decoded* shape your UI uses.

// ───────────────────────────────────────────────────────────────────
// Primitives
// ───────────────────────────────────────────────────────────────────

/** Cardano amount in lovelace. 1 ADA = 1_000_000 lovelace. Use bigint for safety. */
export type Lovelace = bigint;

/** POSIX time in milliseconds (Plutus V3 POSIXTime). */
export type POSIXTime = number;

/** Hex-encoded public key hash (28 bytes / 56 hex chars). */
export type PubKeyHash = string;

/** Hex-encoded asset class — `${policyId}.${assetName}`. */
export type AssetClass = string;

/** Hex-encoded token name. UI may decode UTF-8 for display. */
export type TokenName = string;

/** Hex-encoded currency symbol (28 bytes). */
export type CurrencySymbol = string;

/** Plutus `BuiltinByteString` — UTF-8 string after off-chain decoding. */
export type BBS = string;

/** Plutus `Maybe a` as TS-idiomatic nullable. */
export type Maybe<T> = T | null;

// ───────────────────────────────────────────────────────────────────
// SlotStatus (RentValidator.hs)
// ───────────────────────────────────────────────────────────────────

export type SlotStatus =
  | 'Available'
  | 'Pending'
  | 'Confirmed'
  | 'Completed'
  | 'Refunded'
  | 'Disputed';

/** Plutus constructor index → status. Mirrors makeIsDataSchemaIndexed order. */
export const SLOT_STATUS_BY_TAG: SlotStatus[] = [
  'Available',
  'Pending',
  'Confirmed',
  'Completed',
  'Refunded',
  'Disputed',
];

// ───────────────────────────────────────────────────────────────────
// RentDatum (RentValidator.hs — one UTxO per slot)
// ───────────────────────────────────────────────────────────────────

export interface RentDatum {
  // Slot identity
  /** 1..168 (1 = Mon 00:00–01:00, 168 = Sun 23:00–00:00). */
  slotId: number;
  slotStart: POSIXTime;
  slotEnd: POSIXTime;
  /** Latest moment the customer may cancel with refund. */
  cancelDeadline: POSIXTime;

  // Pricing
  rentPrice: Lovelace;
  /** Basis points (100 = 1%). */
  siteCommissionBps: number;

  // Ownership
  ownerNFTName: TokenName;
  ownerPkh: PubKeyHash;
  companyPkh: PubKeyHash;

  // State
  status: SlotStatus;
  customerPkh: Maybe<PubKeyHash>;
  /** Set on ConfirmRent (Tx 5), cleared on RedeemAtField / CancelRent. */
  rentNFTName: Maybe<TokenName>;
  /** Set on OpenDispute (Tx 7) — customer's escrowed deposit. */
  disputeDeposit: Maybe<Lovelace>;

  // Field metadata (replicated for off-chain UX)
  fieldName: BBS;
  fieldAddress: BBS;
  phone: BBS;
  email: BBS;
  lat: BBS;
  long: BBS;
  paymentAddress: BBS;
}

// ───────────────────────────────────────────────────────────────────
// RentRedeemer
// ───────────────────────────────────────────────────────────────────

export type RentRedeemer =
  | { tag: 'Reserve'; customerPkh: PubKeyHash }   // index 0 · Tx 4
  | { tag: 'ConfirmRent' }                         // index 1 · Tx 5
  | { tag: 'CancelRent' }                          // index 2 · Tx 6
  | { tag: 'OpenDispute' }                         // index 3 · Tx 7
  | { tag: 'RedeemAtField' }                       // index 4 · Tx 8
  | { tag: 'CollectSlot' }                         // index 5 · Tx 9
  | { tag: 'ResolveToCustomer' }                   // index 6 · Tx 11
  | { tag: 'ResolveToOwner' };                     // index 7 · Tx 12

// ───────────────────────────────────────────────────────────────────
// OwnersDatum (OwnersValidator.hs — sum of two variants)
// ───────────────────────────────────────────────────────────────────

export interface CompanyConfig {
  /** 100 = 1%. */
  siteCommissionBps: number;
  /** Fee charged to open or resolve a dispute. */
  disputeFee: Lovelace;
  /** Fee an owner pays to register. */
  registrationFee: Lovelace;
  /** Collateral locked when an owner registers. */
  collateral: Lovelace;
  /** Max disputes an owner can lose before being flagged. */
  maxDisputeLosses: number;
  companyPkh: PubKeyHash;
}

export interface OwnerRecord {
  ownerNFTName: TokenName;
  ownerPkh: PubKeyHash;

  // On-chain stats (the only "reputation" the contract knows)
  rentalsCompleted: number;
  rentalsRefunded: number;
  rentalsDisputed: number;
  /** Number of Rent NFTs the owner has redeemed at their field (Tx 8). */
  rentNFTsProven: number;

  // Mutable profile (Tx 10 UpdateOwnerInfo)
  fieldName: BBS;
  address: BBS;
  phone: BBS;
  email: BBS;
  lat: BBS;
  long: BBS;
  paymentAddress: BBS;
}

export type OwnersDatum =
  | { kind: 'Company'; config: CompanyConfig }   // index 0
  | { kind: 'Owner'; record: OwnerRecord };      // index 1

// ───────────────────────────────────────────────────────────────────
// OwnersRedeemer
// ───────────────────────────────────────────────────────────────────

export type OwnersRedeemer =
  | 'UpdateCompanyConfig'   // index 0
  | 'CollectPayments'       // index 1 · Tx 9
  | 'UpdateOwnerInfo'       // index 2 · Tx 10
  | 'ResolveToCustomer'     // index 3 · Tx 11
  | 'ResolveToOwner';       // index 4 · Tx 12

// ───────────────────────────────────────────────────────────────────
// Minting redeemers
// ───────────────────────────────────────────────────────────────────

export type OwnersMintingRedeemer =
  | { tag: 'MintOwnerNFT'; newOwnerPkh: PubKeyHash }   // index 0 · Tx 2
  | { tag: 'BurnOwnerNFT' };                            // index 1

export type RentMintingRedeemer =
  | { tag: 'MintRentNFT'; customerPkh: PubKeyHash }    // index 0 · Tx 5
  | { tag: 'BurnRentNFT'; signerPkh: PubKeyHash };     // index 1 · Tx 6 / 8 / 11 / 12

// ───────────────────────────────────────────────────────────────────
// UI-only: FieldDiscovery
// ───────────────────────────────────────────────────────────────────

/** Aggregated view of one field (grouped by ownerNFTName) for FieldDiscovery cards. */
export interface FieldSummary {
  ownerNFTName: TokenName
  fieldName: BBS
  fieldAddress: BBS
  phone: BBS
  email: BBS
  lat: BBS
  long: BBS
  rentPrice: Lovelace
  /** Available slots matching the active SlotFilter. */
  slotsAvailable: number
}
