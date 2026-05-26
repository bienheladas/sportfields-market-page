// Hook para construir, firmar y enviar la Tx 6 — CancelRent.
//
// Flujo on-chain:
//   Input  : slot UTxO en el RentValidator (status Confirmed | Pending)
//   Output : misma dirección, datum reseteado a Available, sin Rent NFT
//   Mint   : -1 RentNFT (solo si Confirmed — Pending no tiene Rent NFT)
//   Refund : rentPrice → customer
//   Signer : customer (extraído de wallet.getChangeAddress)
//
// La estructura espeja useReserveSlot.ts.

import * as React from 'react';
import { useWallet } from '@meshsdk/react';
import { BlockfrostProvider, MeshTxBuilder } from '@meshsdk/core';
import { Serialization } from '@cardano-sdk/core';

import {
  BLOCKFROST_KEY,
  RENT_VALIDATOR_ADDR,
  RENT_REF_TXHASH,
  RENT_REF_INDEX,
  RENT_MINT_POLICY_ID,
  RENT_MINT_SCRIPT_CODE,
} from '../lib/config';
import {
  pConstr,
  pBytes,
  pAvailable,
  pNothing,
  buildRentDatumHex,
} from '../lib/plutus-cbor';
import { fixScriptDataHash } from '../lib/fixScriptDataHash';
import { normalizeMeshUtxos, normalizeAddress } from '../lib/decoders';
import { addressToPkh } from './useReserveSlot';
import { unwrapSubmitError } from '../lib/unwrapSubmitError';
import type { RentSlotUtxoLike } from '../components/WeekCalendar';

const EPOCH_SIZE = 86400;

export interface UseCancelSlot {
  cancel: (slot: RentSlotUtxoLike) => Promise<string>;
  loading: boolean;
  error: string | null;
}

export function useCancelSlot(): UseCancelSlot {
  const { wallet, connected } = useWallet();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const cancel = React.useCallback(
    async (slot: RentSlotUtxoLike): Promise<string> => {
      if (!connected || !wallet) {
        throw new Error('Conectá tu wallet para cancelar.');
      }

      // ── Validaciones cliente-side ─────────────────────────────
      if (Date.now() > slot.datum.cancelDeadline) {
        throw new Error(
          `El plazo de cancelación ya venció (${new Date(slot.datum.cancelDeadline).toLocaleString('es-AR')}).`,
        );
      }
      if (slot.datum.status !== 'Confirmed' && slot.datum.status !== 'Pending') {
        throw new Error(
          `Solo se puede cancelar un slot Confirmed o Pending (actual: ${slot.datum.status}).`,
        );
      }
      if (slot.datum.status === 'Confirmed' && !slot.datum.rentNFTName) {
        throw new Error(
          'Slot Confirmed sin rentNFTName en el datum — estado inconsistente. Recargá y volvé a intentar.',
        );
      }

      setLoading(true);
      setError(null);

      try {
        // ── Paso 1 — Identidad del customer ────────────────────
        const walletAddress = normalizeAddress(await wallet.getChangeAddress());
        const customerPkh = addressToPkh(walletAddress);
        const customerPkhBuf = Buffer.from(customerPkh, 'hex');

        // ── Paso 2 — Token name del Rent NFT (solo si Confirmed)
        const isConfirmed = slot.datum.status === 'Confirmed';
        const tokenNameHex = isConfirmed ? slot.datum.rentNFTName! : null;

        // ── Paso 3 — invalidHereafter (Cardano slot) ───────────
        const [blockRes, epochRes] = await Promise.all([
          fetch('https://cardano-preview.blockfrost.io/api/v0/blocks/latest', {
            headers: { project_id: BLOCKFROST_KEY },
          }).then((r) => r.json()),
          fetch('https://cardano-preview.blockfrost.io/api/v0/epochs/latest', {
            headers: { project_id: BLOCKFROST_KEY },
          }).then((r) => r.json()),
        ]);

        const refCardanoSlot = blockRes.slot as number;
        const refTimeMs = (blockRes.time as number) * 1000;
        const currentEpoch = epochRes.epoch as number;
        const eraLastSlot = (currentEpoch + 1) * EPOCH_SIZE - 1;

        const cancelDeadlineMs = slot.datum.cancelDeadline;
        const cancelCardano =
          refCardanoSlot + Math.floor((cancelDeadlineMs - refTimeMs) / 1000);
        const invalidHereafter = Math.min(cancelCardano, eraLastSlot);

        // ── Paso 4 — Redeemers ────────────────────────────────
        const spendRedeemerHex = pConstr(2, []).toString('hex');
        const mintRedeemerHex = isConfirmed
          ? pConstr(1, [pBytes(customerPkhBuf)]).toString('hex')
          : null;

        // ── Paso 5 — Datum actualizado (→ Available) ──────────
        const d = slot.datum;
        const updatedDatumHex = buildRentDatumHex({
          slotId: d.slotId,
          slotStart: d.slotStart,
          slotEnd: d.slotEnd,
          cancelDeadline: d.cancelDeadline,
          rentPrice: Number(d.rentPrice),
          commissionBps: d.siteCommissionBps,
          ownerNFTName: Buffer.from(d.ownerNFTName, 'hex'),
          ownerPkh: Buffer.from(d.ownerPkh, 'hex'),
          companyPkh: Buffer.from(d.companyPkh, 'hex'),
          status: pAvailable(),
          customerPkh: pNothing(),
          rentNFTName: pNothing(),
          disputeDeposit: pNothing(),
          fieldName: Buffer.from(d.fieldName, 'hex'),
          fieldAddress: Buffer.from(d.fieldAddress, 'hex'),
          phone: Buffer.from(d.phone, 'hex'),
          email: Buffer.from(d.email, 'hex'),
          lat: Buffer.from(d.lat, 'hex'),
          long_: Buffer.from(d.long, 'hex'),
          paymentAddress: Buffer.from(d.paymentAddress, 'hex'),
        });

        // ── Paso 6 — ADA flow ─────────────────────────────────
        const inputLovelace = slot.lovelace;
        const continuingLovelace = inputLovelace - d.rentPrice;
        const refundLovelace = d.rentPrice;

        // ── Paso 7 — UTxOs + colateral ────────────────────────
        const rawUtxos = await wallet.getUtxos();
        const utxos = normalizeMeshUtxos(rawUtxos as unknown[]);

        const collateralUtxo = utxos.find((u) => {
          const amt = u.output.amount;
          return (
            amt.length === 1 &&
            amt[0].unit === 'lovelace' &&
            BigInt(amt[0].quantity) >= 5_000_000n
          );
        });
        if (!collateralUtxo) {
          throw new Error('No hay UTxO puro-ADA ≥ 5 ADA para colateral.');
        }

        // ── Paso 8 — Build Tx ─────────────────────────────────
        const provider = new BlockfrostProvider(BLOCKFROST_KEY);
        const txBuilder = new MeshTxBuilder({
          fetcher: provider,
          submitter: provider,
        });

        txBuilder
          .spendingPlutusScriptV3()
          .txIn(
            slot.txHash,
            slot.outputIndex,
            [{ unit: 'lovelace', quantity: String(inputLovelace) }],
            RENT_VALIDATOR_ADDR,
          )
          .txInInlineDatumPresent()
          .txInRedeemerValue(spendRedeemerHex, 'CBOR', {
            mem: 14_000_000,
            steps: 10_000_000_000,
          })
          .spendingTxInReference(RENT_REF_TXHASH, RENT_REF_INDEX);

        if (isConfirmed) {
          txBuilder
            .mintPlutusScriptV3()
            .mint('-1', RENT_MINT_POLICY_ID, tokenNameHex!)
            .mintingScript(RENT_MINT_SCRIPT_CODE)
            .mintRedeemerValue(mintRedeemerHex!, 'CBOR', {
              mem: 14_000_000,
              steps: 10_000_000_000,
            });
        }

        txBuilder
          .txOut(RENT_VALIDATOR_ADDR, [
            { unit: 'lovelace', quantity: String(continuingLovelace) },
          ])
          .txOutInlineDatumValue(updatedDatumHex, 'CBOR')
          .txOut(walletAddress, [
            { unit: 'lovelace', quantity: String(refundLovelace) },
          ])
          .invalidHereafter(invalidHereafter)
          .txInCollateral(
            collateralUtxo.input.txHash,
            collateralUtxo.input.outputIndex,
            collateralUtxo.output.amount,
            collateralUtxo.output.address,
          )
          .requiredSignerHash(customerPkh)
          .changeAddress(walletAddress)
          .selectUtxosFrom(utxos);

        const unsignedTx = await txBuilder.complete();

        // ── Paso 9 — fixScriptDataHash ────────────────────────
        const fixedTx = await fixScriptDataHash(
          unsignedTx,
          {
            tx_hash: slot.txHash,
            output_index: slot.outputIndex,
            amount: [{ unit: 'lovelace', quantity: String(inputLovelace) }],
            inline_datum: updatedDatumHex,
            address: RENT_VALIDATOR_ADDR,
          },
          collateralUtxo,
        );

        // ── Paso 10 — Sign & submit ───────────────────────────
        const cip30Result = await wallet.signTx(fixedTx, true);
        const firstByte = parseInt(cip30Result.slice(0, 2), 16);

        let finalTxHex: string;
        if (firstByte >= 0x80 && firstByte <= 0x9f) {
          finalTxHex = cip30Result;
        } else {
          const tx = Serialization.Transaction.fromCbor(
            Serialization.TxCBOR(fixedTx),
          );
          const witSet = Serialization.TransactionWitnessSet.fromCbor(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cip30Result as any,
          );
          const txWit = tx.witnessSet();
          const vkeys = witSet.vkeys();
          if (vkeys && vkeys.size() > 0) txWit.setVkeys(vkeys);
          tx.setWitnessSet(txWit);
          finalTxHex = String(tx.toCbor());
        }

        const txHash = await provider.submitTx(finalTxHex);
        return txHash;
      } catch (e) {
        const msg = unwrapSubmitError(e);
        setError(msg);
        throw new Error(msg);
      } finally {
        setLoading(false);
      }
    },
    [wallet, connected],
  );

  return { cancel, loading, error };
}
