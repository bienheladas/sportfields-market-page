// Tx: Reserve slot (INSERT) — create Node(Pending) in sorted linked list.
// Spends predecessor with InsertPrev { new_next: Key(slotId) }.
// If predecessor is a Node (not Head), Head must be in reference_inputs.

import { useState } from 'react'
import { Data, Constr, applyParamsToScript } from '@lucid-evolution/lucid'
import { useLucid } from '../lib/LucidContext'
import {
  RENT_VALIDATOR_ADDR,
  RENT_NFT_POLICY,
  OWNER_NFT_POLICY,
  COMPANY_PKH,
  RENT_SPEND_COMPILED,
  RENT_MINT_COMPILED,
} from '../lib/config'
import { decodeRentDatum, decodeListHeadDatum, hexToBytes } from '../lib/decoders'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'
import { rentNftMetadata721 } from '../lib/rentNftMetadata'
import type { ListHeadUtxo } from './useRentSlots'
import type { NodeKey } from '../components/types'

const appliedRentSpend = applyParamsToScript(RENT_SPEND_COMPILED, [
  new Constr(0, [OWNER_NFT_POLICY, RENT_NFT_POLICY])
])
const appliedRentMint = applyParamsToScript(RENT_MINT_COMPILED, [
  new Constr(0, [COMPANY_PKH])
])

function nodeKeyConstr(nk: NodeKey): Constr<Data> {
  return nk.tag === 'Empty' ? new Constr(1, []) : new Constr(0, [BigInt(nk.key)])
}

function rebuildPredDatum(rawDatum: string, newNextConstr: Constr<Data>): string {
  const outer = Data.from(rawDatum) as Constr<Data>
  const inner = outer.fields[0] as Constr<Data>
  const nextIdx = Number(outer.index) === 0 ? 11 : 20  // Head: 12 fields, next@11; Node: 21 fields, next@20
  const newFields = [...inner.fields]
  newFields[nextIdx] = newNextConstr
  return Data.to(new Constr(Number(outer.index), [new Constr(Number(inner.index), newFields)]))
}

export function useReserveSlot() {
  const { lucid, pkh: customerPkh } = useLucid()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  /**
   * Reserva un slot (alquiler directo M2: Confirmed + pago completo en una tx).
   * - `payWithLoyalty` (U): quema loyalty_nfts_required NFTs de lealtad en vez
   *   de pagar — el slot nace con rent_price 0, sin NFT propio, no cancelable
   *   ni disputable.
   * - `depositOnly` (C/N): reserva con depósito del 50% — el slot nace Pending,
   *   sin Rent NFT (se acuña al confirmar). El cliente confirma después con
   *   useConfirmRent (pestaña "Pendientes") pagando el resto ANTES del
   *   cancel_deadline; si no confirma, el owner puede cerrarlo (ForceClosePending).
   * - Si la semana tiene loyalty_nfts_required = 0 (R): no se mintea Rent NFT
   *   y el flujo feliz termina en Confirmed (sin redención).
   */
  const reserve = async (
    headParam: ListHeadUtxo,
    slotId: number,
    opts: { payWithLoyalty?: boolean; depositOnly?: boolean } = {},
  ): Promise<string> => {
    if (!lucid) throw new Error('Wallet no conectada')

    setLoading(true)
    setError(null)

    try {
      // Fetch fresh UTxOs
      console.log('[reserve] 1/5 consultando UTxOs del contrato…')
      const allUtxos = await lucid.utxosAt(RENT_VALIDATOR_ADDR)
      console.log('[reserve] 1/5 ok —', allUtxos.length, 'UTxOs')

      // Locate head UTxO on-chain
      const headUtxo = allUtxos.find(u =>
        u.txHash === headParam.txHash && u.outputIndex === headParam.outputIndex
      )
      if (!headUtxo || !headUtxo.datum) throw new Error('Head UTxO no encontrado en la cadena')

      const headDatum = decodeListHeadDatum(headUtxo.datum)
      if (!headDatum.config.openSlotIds.includes(slotId))
        throw new Error(`Slot ${slotId} no está en open_slot_ids del head`)

      // Compute this head's week boundary up front so we can scope the node search to it —
      // an owner can have multiple concurrent weeks (M3), each its own linked list, and slot
      // IDs are reused across weeks. Matching by ownerNFTName alone mixes lists from different
      // weeks together and corrupts the predecessor search.
      const thisWeekEnd = headDatum.config.weekStartPosix + 7 * 24 * 3_600_000

      // Parse all Node UTxOs for this owner's week
      type NodeInfo = { utxo: typeof headUtxo; slotId: number; rawNext: NodeKey; rawDatum: string }
      const nodes: NodeInfo[] = []
      for (const u of allUtxos) {
        if (!u.datum) continue
        if (u.txHash === headUtxo.txHash && u.outputIndex === headUtxo.outputIndex) continue
        try {
          const d = decodeRentDatum(u.datum)
          if (d && d.ownerNFTName === headDatum.ownerNFTName && d.weekEnd === thisWeekEnd) {
            nodes.push({ utxo: u, slotId: d.slotId, rawNext: d.next, rawDatum: u.datum })
          }
        } catch { /* skip malformed */ }
      }
      nodes.sort((a, b) => a.slotId - b.slotId)

      // Find predecessor: last node with slotId < target (or head if none)
      let predUtxo = headUtxo
      let predNext: NodeKey = headDatum.next
      let predIsHead = true
      let predRawDatum = headUtxo.datum

      for (const node of nodes) {
        if (node.slotId < slotId) {
          predUtxo    = node.utxo
          predNext    = node.rawNext
          predIsHead  = false
          predRawDatum = node.rawDatum
        } else {
          break
        }
      }

      // Verify insertion point is valid (predNext should point past slotId or be Empty)
      if (predNext.tag === 'Key' && predNext.key <= slotId)
        throw new Error(`Slot ${slotId} ya existe o la lista está desincronizada`)

      // Compute slot times from head WeekConfig
      const cfg = headDatum.config
      const slotStart      = cfg.weekStartPosix + (slotId - 1) * cfg.slotDurationMs
      const slotEnd        = slotStart + cfg.slotDurationMs
      const cancelDeadline = slotStart - cfg.cancelDeadlineOffsetMs
      const weekEnd        = cfg.weekStartPosix + 7 * 24 * 3_600_000

      // Rent NFT name: LAST 4 bytes of ownerNFTName (field's random suffix, not
      // the owner's pkh prefix) + customerPkh (32 bytes total) — field-specific.
      const rentNFTName = headDatum.ownerNFTName.slice(-8) + customerPkh
      const rentNFTUnit = RENT_NFT_POLICY + rentNFTName

      // Camino de la reserva (ver check_insert_prev):
      //   C/N: depósito 50% → status Pending, sin mint (NFT al confirmar).
      //   R: lealtad apagada → sin mint, precio normal.
      //   U: pago con lealtad → quema N NFTs, rent_price 0, sin NFT propio.
      //   M2 (default): mint del Rent NFT + pago completo.
      const loyaltyOff    = cfg.loyaltyNftsRequired === 0
      const payWithLoyalty = opts.payWithLoyalty === true
      const depositOnly    = opts.depositOnly === true
      if (payWithLoyalty && loyaltyOff)
        throw new Error('Esta semana no tiene programa de lealtad')
      if (payWithLoyalty && depositOnly)
        throw new Error('El pago con lealtad no admite depósito parcial')
      const datumRentPrice = payWithLoyalty ? 0n : cfg.rentPrice
      const mintsNft       = !loyaltyOff && !payWithLoyalty && !depositOnly
      const deposit        = cfg.rentPrice * 5000n / 10000n  // 50% (C)

      // New node's next = predecessor's old next
      const slotNextConstr = nodeKeyConstr(predNext)

      // Build new Node datum: SlotDatum::Node(RentDatum) — status Confirmed (skipping ConfirmRent)
      const newNodeDatum = Data.to(new Constr(1, [new Constr(0, [
        BigInt(slotId),
        BigInt(slotStart),
        BigInt(slotEnd),
        BigInt(cancelDeadline),
        datumRentPrice,                             // U: 0 si se paga con lealtad
        BigInt(cfg.siteCommissionBps),
        headDatum.ownerNFTName,
        headDatum.ownerPkh,
        headDatum.companyPkh,
        depositOnly ? new Constr(1, []) : new Constr(2, []),  // status = Pending (C) | Confirmed
        new Constr(0, [customerPkh]),               // customerPkh = Some(customerPkh)
        mintsNft ? new Constr(0, [rentNFTName]) : new Constr(1, []),  // rentNFTName (C/R/U: None)
        new Constr(1, []),                          // disputeDeposit = None
        headDatum.fieldName,
        headDatum.fieldAddress,
        headDatum.phone,
        headDatum.email,
        headDatum.lat,
        headDatum.long,
        headDatum.paymentAddress,
        slotNextConstr,                             // next = pred's old next
        BigInt(weekEnd),                            // week_end
        BigInt(cfg.loyaltyNftsRequired),            // loyalty_nfts_required
        cfg.guaranteePerSlot,                       // guarantee_per_slot — M3
      ])]))

      // Predecessor continues with next = Key(slotId)
      const newPredDatum = rebuildPredDatum(predRawDatum, new Constr(0, [BigInt(slotId)]))

      // Redeemers
      const insertRedeemer = Data.to(new Constr(7, [new Constr(0, [BigInt(slotId)])]))  // InsertPrev
      const mintRedeemer   = Data.to(new Constr(0, [customerPkh]))                      // MintRentNFT

      // validTo must be before slotStart - 60_000 (on-chain check_insert_prev).
      // Also cap at Date.now() + 10min to avoid TimeTranslationPastHorizon.
      const reserveDeadline = slotStart - 60_000

      const fieldNameText = new TextDecoder().decode(hexToBytes(headDatum.fieldName))

      let txBuilder = lucid.newTx()
        .collectFrom([predUtxo], insertRedeemer)
        .attach.SpendingValidator({ type: 'PlutusV3', script: appliedRentSpend })
        // Predecessor continues — preserve its FULL value, not just lovelace (a
        // predecessor that's itself a Confirmed/Disputed slot may escrow its own NFT).
        .pay.ToContract(
          RENT_VALIDATOR_ADDR,
          { kind: 'inline', value: newPredDatum },
          predUtxo.assets,
        )
        .addSignerKey(customerPkh)
        .validTo(Math.min(reserveDeadline - 1, Date.now() + 10 * 60_000))

      if (mintsNft) {
        // M2: mint del Rent NFT + pago completo, CIP-25 en la tx que mintea
        txBuilder = txBuilder
          .mintAssets({ [rentNFTUnit]: 1n }, mintRedeemer)
          .attach.MintingPolicy({ type: 'PlutusV3', script: appliedRentMint })
          .attachMetadata(721, rentNftMetadata721(RENT_NFT_POLICY, rentNFTName, fieldNameText))
          .pay.ToContract(
            RENT_VALIDATOR_ADDR,
            { kind: 'inline', value: newNodeDatum },
            { lovelace: cfg.rentPrice, [rentNFTUnit]: 1n },
          )
      } else if (payWithLoyalty) {
        // U: quema exacta de N NFTs de lealtad — el slot lleva solo su min-ADA
        const burnRedeemer = Data.to(new Constr(1, [customerPkh]))  // BurnRentNFT
        txBuilder = txBuilder
          .mintAssets({ [rentNFTUnit]: -BigInt(cfg.loyaltyNftsRequired) }, burnRedeemer)
          .attach.MintingPolicy({ type: 'PlutusV3', script: appliedRentMint })
          .pay.ToContract(
            RENT_VALIDATOR_ADDR,
            { kind: 'inline', value: newNodeDatum },
            { lovelace: 2_000_000n },
          )
      } else if (depositOnly) {
        // C/N: reserva Pending con depósito del 50% — sin mint
        txBuilder = txBuilder.pay.ToContract(
          RENT_VALIDATOR_ADDR,
          { kind: 'inline', value: newNodeDatum },
          { lovelace: deposit },
        )
      } else {
        // R: lealtad apagada — pago completo sin mint
        txBuilder = txBuilder.pay.ToContract(
          RENT_VALIDATOR_ADDR,
          { kind: 'inline', value: newNodeDatum },
          { lovelace: cfg.rentPrice },
        )
      }

      // If pred is a Node, head must be a reference input (for WeekConfig validation)
      if (!predIsHead) {
        txBuilder = txBuilder.readFrom([headUtxo])
      }

      console.log('[reserve] 2/5 construyendo tx (coin selection + evaluación)…')
      const tx     = await txBuilder.complete()
      console.log('[reserve] 3/5 tx lista — pidiendo firma a la wallet…')
      const signed = await tx.sign.withWallet().complete()
      console.log('[reserve] 4/5 firmada — enviando…')
      const hash = await signed.submit()
      console.log('[reserve] 5/5 enviada:', hash)
      return hash
    } catch (e: unknown) {
      const msg = unwrapSubmitError(e)
      setError(msg)
      throw new Error(msg)
    } finally {
      setLoading(false)
    }
  }

  return { reserve, loading, error }
}
