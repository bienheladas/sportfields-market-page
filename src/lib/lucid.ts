import type { LucidEvolution } from '@lucid-evolution/lucid'
import { BLOCKFROST_KEY, BLOCKFROST_URL } from './config'

let _lucid: LucidEvolution | null = null

// Q0 (code-splitting): Lucid/CML (~2.8 MB de JS + ~4 MB de WASM) se cargan con
// import() dinámico — nada de esto entra al bundle inicial de la web; se descarga
// la primera vez que hace falta (conectar wallet / construir una tx).
export async function getLucid(): Promise<LucidEvolution> {
  if (!_lucid) {
    const [{ Lucid, Blockfrost }, { patchCmlFromJson }] = await Promise.all([
      import('@lucid-evolution/lucid'),
      import('./patchCmlFromJson'),
    ])
    // El parche de CML corría en main.tsx (arranque) — solo necesita correr antes
    // del primer attachMetadata, así que vive aquí junto a la carga de CML.
    patchCmlFromJson()
    _lucid = await Lucid(new Blockfrost(BLOCKFROST_URL, BLOCKFROST_KEY), 'Preview')
  }
  return _lucid
}
