// loyalty.ts — helpers del programa de lealtad (movido de useRedeemFree al
// eliminarse RedeemFree en la Mejora U: el canje ahora es un camino de la reserva).

import { RENT_NFT_POLICY } from './config'

/** Unit del NFT de lealtad de un (cancha, cliente): policy + últimos 4 bytes
 *  del owner_nft_name (sufijo de la cancha) + customer_pkh. */
export function loyaltyNftUnit(ownerNFTName: string, customerPkh: string): string {
  return RENT_NFT_POLICY + ownerNFTName.slice(-8) + customerPkh
}
