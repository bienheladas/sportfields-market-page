// embeddedWallet.ts — Mejora Q: capa de claves de la wallet embebida de propósito específico.
//
// La identidad es la seed (BIP-39/CIP-1852): la misma seed restaurada aquí y en Lace deriva el
// mismo customer_pkh (cuenta 0, m/1852'/1815'/0'/0/0 — el default de Lace y de selectWallet.fromSeed).
// La seed solo se persiste en la app nativa (Keychain/Keystore vía Capacitor, ver getSeedStorage);
// en browser vive únicamente en memoria y muere al recargar. Nunca al servidor, nunca por QR/red.

import { generateSeedPhrase, getAddressDetails } from '@lucid-evolution/lucid'
import { getLucid } from './lucid'
import { isNativeApp } from './appPlatform'
import { getAddressUtxos } from './blockfrost'
import { decodeRentDatum } from './decoders'
import { RENT_VALIDATOR_ADDR } from './config'

export interface SeedStorage {
  load(): Promise<string | null>
  save(seed: string): Promise<void>
  clear(): Promise<void>
}

let memorySeed: string | null = null

const memoryStorage: SeedStorage = {
  async load() { return memorySeed },
  async save(seed: string) { memorySeed = seed },
  async clear() { memorySeed = null },
}

const SEED_KEY = 'sportfields-seed'

// En la app nativa la seed persiste en Keychain (iOS) / Keystore-cifrado (Android).
// El plugin se carga con import() dinámico: el bundle web nunca lo incluye.
// isNativePlatform() real (no el fallback ?app=1) — en browser no hay secure storage.
async function nativeSecureStorage(): Promise<SeedStorage> {
  const { SecureStorage } = await import('@aparajita/capacitor-secure-storage')
  return {
    async load() { return await SecureStorage.getItem(SEED_KEY) },
    async save(seed: string) { await SecureStorage.setItem(SEED_KEY, seed) },
    async clear() { await SecureStorage.remove(SEED_KEY) },
  }
}

export async function getSeedStorage(): Promise<SeedStorage> {
  const cap = (window as any).Capacitor
  if (isNativeApp() && cap?.isNativePlatform?.()) {
    return await nativeSecureStorage()
  }
  return memoryStorage
}

export function createSeed(): string {
  return generateSeedPhrase()
}

export function normalizeSeed(input: string): string {
  return input.trim().toLowerCase().split(/\s+/).join(' ')
}

export function seedWordCount(input: string): number {
  const normalized = normalizeSeed(input)
  return normalized ? normalized.split(' ').length : 0
}

// Deriva la dirección base de la cuenta 0 sin conectar la sesión. Lanza si el mnemonic es inválido.
export async function deriveAddressFromSeed(seed: string): Promise<string> {
  const lucid = await getLucid()
  lucid.selectWallet.fromSeed(normalizeSeed(seed))
  return await lucid.wallet().address()
}

// ---------------------------------------------------------------------------
// Verificación con evidencia on-chain (restauración de seed)
// En vez de pedir al usuario comparar direcciones a ojo, se le muestra qué hay
// en la red bajo la clave derivada: balance y reservas. Una wallet en modo
// multi-dirección (Lace) deriva pkhs distintos por índice — la evidencia lo
// hace visible ("0 ₳, 0 reservas") sin depender de la comparación visual.
// ---------------------------------------------------------------------------

export interface SeedEvidence {
  address: string
  pkh: string
  lovelace: bigint
  utxoCount: number
  reservationCount: number
}

export async function probeSeedOnChain(seed: string): Promise<SeedEvidence> {
  const address = await deriveAddressFromSeed(seed)
  const pkh = getAddressDetails(address).paymentCredential?.hash ?? ''

  let lovelace = 0n
  let utxoCount = 0
  try {
    const utxos = await getAddressUtxos(address)
    utxoCount = utxos.length
    for (const u of utxos) {
      lovelace += BigInt(u.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0')
    }
  } catch (e) {
    // Blockfrost devuelve 404 para direcciones nunca vistas en cadena — no es error.
    if (!isNotFound(e)) throw e
  }

  let reservationCount = 0
  try {
    const rentUtxos = await getAddressUtxos(RENT_VALIDATOR_ADDR)
    for (const u of rentUtxos) {
      if (!u.inline_datum) continue
      try {
        const d = decodeRentDatum(u.inline_datum)
        if (d && d.customerPkh === pkh) reservationCount++
      } catch { /* head u otro datum — no cuenta */ }
    }
  } catch { /* la evidencia de reservas es best-effort; el balance ya se obtuvo */ }

  return { address, pkh, lovelace, utxoCount, reservationCount }
}

function isNotFound(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'response' in e &&
    (e as { response?: { status?: number } }).response?.status === 404
}
