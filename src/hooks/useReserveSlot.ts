// Tx 4 — Reserve slot: Available → Confirmed + mint Rent NFT to customer.
// Browser port of off-chain/rent-slot.mjs.

import { useState } from 'react'
import { useWallet } from '@meshsdk/react'
import { BlockfrostProvider, MeshTxBuilder, resolvePaymentKeyHash } from '@meshsdk/core'
import {
  BLOCKFROST_KEY,
  RENT_VALIDATOR_ADDR,
  RENT_REF_TXHASH,
  RENT_REF_INDEX,
  RENT_MINT_POLICY_ID,
  RENT_MINT_SCRIPT_CODE,
} from '../lib/config'

// CIP-19: address bytes = header(1) + payment_pkh(28) [+ staking_pkh(28)]
// Lace (and some wallets) return hex addresses instead of bech32.
export function addressToPkh(addr: string): string {
  if (addr.startsWith('addr')) return resolvePaymentKeyHash(addr)
  // hex address: skip 1 header byte → take next 28 bytes
  return addr.slice(2, 58).toLowerCase()
}
import {
  pConstr, pBytes, pConfirmed, pNothing, pJust, buildRentDatumHex,
} from '../lib/plutus-cbor'
import { Serialization } from '@cardano-sdk/core'
import { fixScriptDataHash } from '../lib/fixScriptDataHash'
import { normalizeMeshUtxos, normalizeAddress, bytesToUtf8 } from '../lib/decoders'
import { unwrapSubmitError } from '../lib/unwrapSubmitError'
import type { RentSlotUtxoLike } from '../components/WeekCalendar'

// ── Metadata helpers ───────────────────────────────────────────────

// CIP-25: all strings ≤ 64 UTF-8 bytes; longer values must be arrays of chunks.
const _enc = new TextEncoder()
function metaChunks(s: string): string | string[] {
  if (_enc.encode(s).length <= 64) return s
  const out: string[] = []
  let chunk = ''
  for (const char of s) {
    if (_enc.encode(chunk + char).length > 64) { out.push(chunk); chunk = char }
    else chunk += char
  }
  if (chunk) out.push(chunk)
  return out.length === 1 ? out[0] : out
}

function decodeField(hex: string): string {
  return bytesToUtf8(Buffer.from(hex, 'hex'))
}

// Police-badge SVG with yellow radial glow — embedded as CIP-25 image.
const BADGE_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">',
  '<defs><radialGradient id="g" cx="50%" cy="50%" r="50%">',
  '<stop offset="0%" stop-color="#FFF9C4"/>',
  '<stop offset="45%" stop-color="#FFD600" stop-opacity=".7"/>',
  '<stop offset="100%" stop-color="#F57F17" stop-opacity="0"/>',
  '</radialGradient></defs>',
  '<circle cx="100" cy="100" r="98" fill="url(#g)"/>',
  '<polygon points="100,10 117,46 155,40 142,75 168,92 145,115 160,150',
  ' 125,145 113,178 100,152 87,178 75,145 40,150 55,115 32,92 58,75',
  ' 45,40 83,46" fill="#1565C0" stroke="#FFD700" stroke-width="2.5"/>',
  '<path d="M100,38L124,53L124,93Q124,114 100,125Q76,114 76,93L76,53Z"',
  ' fill="#0D47A1" stroke="#FFD700" stroke-width="1.5"/>',
  '<text x="100" y="79" text-anchor="middle" font-family="Arial"',
  ' font-size="13" font-weight="bold" fill="#FFD700">NFT</text>',
  '<text x="100" y="96" text-anchor="middle" font-family="Arial"',
  ' font-size="9" font-weight="bold" fill="#fff">RENTAL</text>',
  '<text x="100" y="111" text-anchor="middle" font-family="Arial"',
  ' font-size="7" fill="#FFD700">CARDANO</text>',
  '<text x="73" y="149" font-size="9" fill="#FFD700">&#9733;</text>',
  '<text x="96" y="153" font-size="10" fill="#FFD700">&#9733;</text>',
  '<text x="119" y="149" font-size="9" fill="#FFD700">&#9733;</text>',
  '</svg>',
].join('')

function buildCip25(
  policyId: string,
  assetName: string,
  slotId: number,
  slotStart: number,
  slotEnd: number,
  cancelDeadline: number,
  fieldName: string,
  fieldAddress: string,
  lat: string,
  lng: string,
): Record<string, unknown> {
  const imgB64   = Buffer.from(BADGE_SVG).toString('base64')
  const imgUri   = 'data:image/svg+xml;base64,' + imgB64
  const name     = `Rental NFT · S${slotId}`

  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ')

  return {
    [policyId]: {
      [assetName]: {
        name,
        image:          metaChunks(imgUri),
        mediaType:      'image/svg+xml',
        description:    metaChunks(`${fieldName} · Slot ${slotId} · ${fmt(slotStart)} – ${fmt(slotEnd)}`),
        slotId,
        slotStart:      fmt(slotStart),
        slotEnd:        fmt(slotEnd),
        cancelDeadline: fmt(cancelDeadline),
        fieldName:      metaChunks(fieldName),
        fieldAddress:   metaChunks(fieldAddress),
        lat:            metaChunks(lat),
        lng:            metaChunks(lng),
        network:        'preview',
      },
      version: '2.0',
    },
  }
}

// ── Token name helpers ─────────────────────────────────────────────

function isoYearWeek(dateMs: number): { year: number; week: number } {
  const d = new Date(dateMs)
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return { year: d.getUTCFullYear(), week }
}

// ── Hook ───────────────────────────────────────────────────────────

export function useReserveSlot() {
  const { wallet, connected } = useWallet()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const reserve = async (slot: RentSlotUtxoLike): Promise<string> => {
    if (!connected || !wallet) throw new Error('Wallet no conectada')

    setLoading(true)
    setError(null)

    try {
      const provider = new BlockfrostProvider(BLOCKFROST_KEY)
      const datum    = slot.datum

      // ── Customer identity ────────────────────────────────────────
      const walletAddress  = normalizeAddress(await wallet.getChangeAddress())
      const customerPkh    = addressToPkh(walletAddress)
      const customerPkhBuf = Buffer.from(customerPkh, 'hex')

      // ── Token name: "{year}-W{week}-S{slotId}" ───────────────────
      const { year, week } = isoYearWeek(datum.slotStart)
      const tokenNameStr   = `${year}-W${week}-S${datum.slotId}`
      const tokenNameBuf   = Buffer.from(tokenNameStr, 'utf8')
      if (tokenNameBuf.length > 32) throw new Error(`Token name too long: ${tokenNameStr}`)
      const tokenNameHex   = tokenNameBuf.toString('hex')
      const tokenUnit      = RENT_MINT_POLICY_ID + tokenNameHex

      // ── Redeemer: Constr 0 [customerPkh] ────────────────────────
      const redeemerHex = pConstr(0, [pBytes(customerPkhBuf)]).toString('hex')

      // ── Updated datum: Available → Confirmed ─────────────────────
      const updatedDatumHex = buildRentDatumHex({
        slotId:         datum.slotId,
        slotStart:      datum.slotStart,
        slotEnd:        datum.slotEnd,
        cancelDeadline: datum.cancelDeadline,
        rentPrice:      Number(datum.rentPrice),
        commissionBps:  datum.siteCommissionBps,
        ownerNFTName:   Buffer.from(datum.ownerNFTName, 'hex'),
        ownerPkh:       Buffer.from(datum.ownerPkh, 'hex'),
        companyPkh:     Buffer.from(datum.companyPkh, 'hex'),
        status:         pConfirmed(),
        customerPkh:    pJust(pBytes(customerPkhBuf)),
        rentNFTName:    pJust(pBytes(tokenNameBuf)),
        disputeDeposit: pNothing(),
        fieldName:      Buffer.from(datum.fieldName, 'hex'),
        fieldAddress:   Buffer.from(datum.fieldAddress, 'hex'),
        phone:          Buffer.from(datum.phone, 'hex'),
        email:          Buffer.from(datum.email, 'hex'),
        lat:            Buffer.from(datum.lat, 'hex'),
        long_:          Buffer.from(datum.long, 'hex'),
        paymentAddress: Buffer.from(datum.paymentAddress, 'hex'),
      })

      // ── Decoded text fields for metadata ────────────────────────
      const fieldNameStr = decodeField(datum.fieldName)
      const fieldAddrStr = decodeField(datum.fieldAddress)
      const latStr       = decodeField(datum.lat)
      const lngStr       = decodeField(datum.long)

      // ── Lovelace ─────────────────────────────────────────────────
      const inputLovelace      = slot.lovelace
      const continuingLovelace = inputLovelace + datum.rentPrice
      const NFT_LOVELACE       = 2_000_000n

      // ── Wallet UTxOs ─────────────────────────────────────────────
      const rawUtxos = await wallet.getUtxos()
      if (rawUtxos.length > 0) console.log('[reserve] UTxO shape sample:', JSON.stringify(rawUtxos[0]))
      const utxos = normalizeMeshUtxos(rawUtxos as unknown[])

      const collateralUtxo = utxos.find(u => {
        const amt = u.output.amount
        return amt.length === 1 && amt[0].unit === 'lovelace' && BigInt(amt[0].quantity) >= 5_000_000n
      })
      if (!collateralUtxo) throw new Error('No hay UTxO puro-ADA ≥ 5 ADA para colateral')


      // ── Build Tx ─────────────────────────────────────────────────
      const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider })

      txBuilder
        .spendingPlutusScriptV3()
        .txIn(
          slot.txHash, slot.outputIndex,
          [{ unit: 'lovelace', quantity: String(inputLovelace) }],
          RENT_VALIDATOR_ADDR,
        )
        .txInInlineDatumPresent()
        .txInRedeemerValue(redeemerHex, 'CBOR', { mem: 14_000_000, steps: 10_000_000_000 })
        .spendingTxInReference(RENT_REF_TXHASH, RENT_REF_INDEX)
        .mintPlutusScriptV3()
        .mint('1', RENT_MINT_POLICY_ID, tokenNameHex)
        .mintingScript(RENT_MINT_SCRIPT_CODE)
        .mintRedeemerValue(redeemerHex, 'CBOR', { mem: 14_000_000, steps: 10_000_000_000 })
        .txOut(RENT_VALIDATOR_ADDR, [{ unit: 'lovelace', quantity: String(continuingLovelace) }])
        .txOutInlineDatumValue(updatedDatumHex, 'CBOR')
        .txOut(walletAddress, [
          { unit: 'lovelace', quantity: String(NFT_LOVELACE) },
          { unit: tokenUnit,  quantity: '1' },
        ])
        .txInCollateral(
          collateralUtxo.input.txHash,
          collateralUtxo.input.outputIndex,
          collateralUtxo.output.amount,
          collateralUtxo.output.address,
        )
        .metadataValue(721, buildCip25(
          RENT_MINT_POLICY_ID, tokenNameStr,
          datum.slotId, datum.slotStart, datum.slotEnd, datum.cancelDeadline,
          fieldNameStr, fieldAddrStr, latStr, lngStr,
        ))
        .requiredSignerHash(customerPkh)
        .changeAddress(walletAddress)
        .selectUtxosFrom(utxos)

      const unsignedTx = await txBuilder.complete()

      // ── Fix script data hash (ExUnits evaluation) ────────────────
      const fixedTx = await fixScriptDataHash(
        unsignedTx,
        {
          tx_hash:      slot.txHash,
          output_index: slot.outputIndex,
          amount:       [{ unit: 'lovelace', quantity: String(inputLovelace) }],
          inline_datum: updatedDatumHex, // re-encoded from decoded fields
          address:      RENT_VALIDATOR_ADDR,
        },
        collateralUtxo,
      )

      // ── Sign & submit ─────────────────────────────────────────────
      // CIP-30 signTx with partialSign=true may return only the witness set
      // (a CBOR map, first byte 0xa..) instead of a full transaction (0x84..).
      // Detect which case we have and merge if needed.
      const cip30Result = await wallet.signTx(fixedTx, true)
      console.log('[reserve] signTx result prefix:', cip30Result.slice(0, 4))

      let finalTxHex: string
      const firstByte = parseInt(cip30Result.slice(0, 2), 16)
      if (firstByte >= 0x80 && firstByte <= 0x9f) {
        // Full transaction CBOR array — use as-is
        finalTxHex = cip30Result
      } else {
        // Witness set only — merge vkey witnesses into fixedTx
        const tx     = Serialization.Transaction.fromCbor(Serialization.TxCBOR(fixedTx))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const witSet = Serialization.TransactionWitnessSet.fromCbor(cip30Result as any)
        const txWit  = tx.witnessSet()
        const vkeys  = witSet.vkeys()
        if (vkeys && vkeys.size() > 0) txWit.setVkeys(vkeys)
        tx.setWitnessSet(txWit)
        finalTxHex = String(tx.toCbor())
      }

      const txHash = await provider.submitTx(finalTxHex)

      return txHash
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
