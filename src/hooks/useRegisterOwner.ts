import * as React from 'react';
import { useWallet } from '@meshsdk/react';
import { BlockfrostProvider, MeshTxBuilder } from '@meshsdk/core';
import { Serialization } from '@cardano-sdk/core';

import {
  BLOCKFROST_KEY,
  OWNERS_VALIDATOR_ADDR,
  OWNERS_MINT_POLICY_ID,
  OWNERS_MINT_SCRIPT_CODE,
  COMPANY_ADDR,
  REGISTRATION_FEE_LOVELACE,
  SCRIPT_LOVELACE,
} from '../lib/config';
import { pConstr, pBytes, buildOwnerDatumHex } from '../lib/plutus-cbor';
import { fixScriptDataHash } from '../lib/fixScriptDataHash';
import { normalizeMeshUtxos, normalizeAddress } from '../lib/decoders';
import { addressToPkh } from './useReserveSlot';
import { unwrapSubmitError } from '../lib/unwrapSubmitError';

export interface RegisterOwnerFields {
  fieldName: string;
  fieldAddress: string;
  phone: string;
  email: string;
  lat: string;
  long_: string;
}

export interface UseRegisterOwner {
  register: (fields: RegisterOwnerFields) => Promise<string>;
  loading: boolean;
  error: string | null;
}

const LIMITS = {
  fieldName: 64,
  fieldAddress: 64,
  phone: 32,
  email: 64,
} as const;

const LATLONG_RE = /^-?\d+\.\d+$/;

function validate(f: RegisterOwnerFields): string | null {
  const utf8Len = (s: string) => new TextEncoder().encode(s).length;
  if (!f.fieldName.trim()) return 'El nombre del campo es requerido.';
  if (utf8Len(f.fieldName) > LIMITS.fieldName)
    return `El nombre del campo no puede superar ${LIMITS.fieldName} bytes UTF-8.`;
  if (!f.fieldAddress.trim()) return 'La dirección es requerida.';
  if (utf8Len(f.fieldAddress) > LIMITS.fieldAddress)
    return `La dirección no puede superar ${LIMITS.fieldAddress} bytes UTF-8.`;
  if (!f.phone.trim()) return 'El teléfono es requerido.';
  if (utf8Len(f.phone) > LIMITS.phone)
    return `El teléfono no puede superar ${LIMITS.phone} bytes.`;
  if (!f.email.trim()) return 'El email es requerido.';
  if (utf8Len(f.email) > LIMITS.email)
    return `El email no puede superar ${LIMITS.email} bytes.`;
  if (!LATLONG_RE.test(f.lat)) return 'La latitud debe ser un número decimal (ej. -34.6037).';
  if (!LATLONG_RE.test(f.long_)) return 'La longitud debe ser un número decimal (ej. -58.3816).';
  return null;
}

export function useRegisterOwner(): UseRegisterOwner {
  const { wallet, connected } = useWallet();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const register = React.useCallback(
    async (fields: RegisterOwnerFields): Promise<string> => {
      if (!connected || !wallet) {
        throw new Error('Conectá tu wallet para registrar tu cancha.');
      }

      const validationError = validate(fields);
      if (validationError) throw new Error(validationError);

      setLoading(true);
      setError(null);

      try {
        // ── Paso 1 — Identidad del owner
        const walletAddress = normalizeAddress(await wallet.getChangeAddress());
        const ownerPkh = addressToPkh(walletAddress);
        const ownerPkhBuf = Buffer.from(ownerPkh, 'hex');
        const tokenNameHex = ownerPkh;

        // ── Paso 2 — Mint redeemer: MintOwnerNFT ownerPkh
        const mintRedeemerHex = pConstr(0, [pBytes(ownerPkhBuf)]).toString('hex');

        // ── Paso 3 — Datum inicial
        const datumHex = buildOwnerDatumHex({
          ownerPkh: ownerPkhBuf,
          fieldName: Buffer.from(fields.fieldName, 'utf8'),
          fieldAddress: Buffer.from(fields.fieldAddress, 'utf8'),
          phone: Buffer.from(fields.phone, 'utf8'),
          email: Buffer.from(fields.email, 'utf8'),
          lat: Buffer.from(fields.lat, 'utf8'),
          long_: Buffer.from(fields.long_, 'utf8'),
        });

        // ── Paso 4 — UTxOs + colateral
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

        const totalLovelace = utxos.reduce((sum, u) => {
          for (const a of u.output.amount) {
            if (a.unit === 'lovelace') return sum + BigInt(a.quantity);
          }
          return sum;
        }, 0n);
        const needed = SCRIPT_LOVELACE + REGISTRATION_FEE_LOVELACE + 2_000_000n;
        if (totalLovelace < needed) {
          throw new Error(
            `Saldo insuficiente. Necesitás ~${(Number(needed) / 1_000_000).toFixed(0)} ADA y tu wallet tiene ${(Number(totalLovelace) / 1_000_000).toFixed(2)} ADA.`,
          );
        }

        // ── Paso 5 — Build Tx
        const provider = new BlockfrostProvider(BLOCKFROST_KEY);
        const txBuilder = new MeshTxBuilder({
          fetcher: provider,
          submitter: provider,
        });

        const tokenUnit = OWNERS_MINT_POLICY_ID + tokenNameHex;

        txBuilder
          .mintPlutusScriptV3()
          .mint('1', OWNERS_MINT_POLICY_ID, tokenNameHex)
          .mintingScript(OWNERS_MINT_SCRIPT_CODE)
          .mintRedeemerValue(mintRedeemerHex, 'CBOR', {
            mem: 14_000_000,
            steps: 10_000_000_000,
          })
          .txOut(OWNERS_VALIDATOR_ADDR, [
            { unit: 'lovelace', quantity: String(SCRIPT_LOVELACE) },
            { unit: tokenUnit, quantity: '1' },
          ])
          .txOutInlineDatumValue(datumHex, 'CBOR')
          .txOut(COMPANY_ADDR, [
            { unit: 'lovelace', quantity: String(REGISTRATION_FEE_LOVELACE) },
          ])
          .txInCollateral(
            collateralUtxo.input.txHash,
            collateralUtxo.input.outputIndex,
            collateralUtxo.output.amount,
            collateralUtxo.output.address,
          )
          .requiredSignerHash(ownerPkh)
          .changeAddress(walletAddress)
          .selectUtxosFrom(utxos);

        const unsignedTx = await txBuilder.complete();

        // ── Paso 6 — fixScriptDataHash (mint-only, sin slotUtxo)
        const fixedTx = await fixScriptDataHash(unsignedTx, null, collateralUtxo);

        // ── Paso 7 — Sign & submit
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

  return { register, loading, error };
}
