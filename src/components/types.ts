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
// Linked-list types (Aiken on-chain)
// ───────────────────────────────────────────────────────────────────

/** Pointer to the next node in the on-chain sorted linked list. */
export type NodeKey =
  | { tag: 'Key'; key: number }
  | { tag: 'Empty' }

/** Per-week configuration stored in ListHead. */
export interface WeekConfig {
  weekStartPosix: number          // POSIX ms
  slotDurationMs: number
  cancelDeadlineOffsetMs: number
  rentPrice: Lovelace
  siteCommissionBps: number
  openSlotIds: number[]           // slot IDs enabled this week
  loyaltyNftsRequired: number
}

/** Datum for the ListHead UTxO at rent_spend. Wraps WeekConfig + next pointer. */
export interface ListHeadDatum {
  ownerNFTName: TokenName
  ownerPkh: PubKeyHash
  companyPkh: PubKeyHash
  fieldName: BBS
  fieldAddress: BBS
  phone: BBS
  email: BBS
  lat: BBS
  long: BBS
  paymentAddress: BBS
  config: WeekConfig
  next: NodeKey
}

// ───────────────────────────────────────────────────────────────────
// RentDatum (Aiken — one UTxO per active slot node)
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
  /** Set on ConfirmRent, cleared on RedeemAtField / CancelRent. */
  rentNFTName: Maybe<TokenName>;
  /** Set on OpenDispute — customer's escrowed deposit. */
  disputeDeposit: Maybe<Lovelace>;

  // Field metadata (replicated for off-chain UX)
  fieldName: BBS;
  fieldAddress: BBS;
  phone: BBS;
  email: BBS;
  lat: BBS;
  long: BBS;
  paymentAddress: BBS;

  /** Linked-list pointer to next node. */
  next: NodeKey;
  weekEnd: POSIXTime;
  loyaltyNftsRequired: number;
}

// ───────────────────────────────────────────────────────────────────
// RentRedeemer (indices match Aiken constructor order)
// ───────────────────────────────────────────────────────────────────

export type RentRedeemer =
  | { tag: 'ConfirmRent' }                          // index 0
  | { tag: 'CancelRent' }                           // index 1
  | { tag: 'OpenDispute' }                          // index 2
  | { tag: 'RedeemAtField' }                        // index 3
  | { tag: 'CollectSlot' }                          // index 4
  | { tag: 'ResolveToCustomer' }                    // index 5
  | { tag: 'ResolveToOwner' }                       // index 6
  | { tag: 'InsertPrev'; newNext: NodeKey }          // index 7
  | { tag: 'RemovePrev'; newNext: NodeKey }          // index 8
  | { tag: 'DeinitWeek' };                          // index 9

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
  guaranteePerSlot: bigint;
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

/** Aggregated view of one field week for FieldDiscovery cards. */
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
  /** weekStartPosix of this week's ListHead — used to open the correct week in FieldDetail. */
  weekStartPosix?: number
  /** txHash of the ListHead UTxO — unique key for React rendering. */
  headTxHash?: string
}
