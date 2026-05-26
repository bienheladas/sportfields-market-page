// react/CompanyConfigCard.tsx
// Renders the CompanyConfig — the company-wide UTxO at OwnersValidator.
// Admin-only view; the "Update" action wires to UpdateCompanyConfig redeemer.

import * as React from 'react';
import type { CompanyConfig } from './types';
import { formatAda, formatBps, shortenAddr } from './lib';
import { Label } from './atoms';

export interface CompanyConfigCardProps {
  config: CompanyConfig;
  onUpdate?: () => void;
}

export function CompanyConfigCard({ config, onUpdate }: CompanyConfigCardProps) {
  return (
    <article className="rounded-[14px] border border-[var(--line)] bg-[var(--paper)] overflow-hidden shadow-[0_1px_2px_rgba(20,16,8,.04)]">
      <header className="px-5 py-4 border-b border-[var(--line)] flex items-center justify-between">
        <div>
          <Label>OwnersValidator · DatumCompany</Label>
          <h3 className="mt-0.5 font-bold text-[18px] tracking-tight">Configuración global</h3>
        </div>
        <span className="font-mono text-[11px] text-[var(--muted)] bg-[var(--paper-2)] px-2 py-1 rounded">
          {shortenAddr(config.companyPkh)}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-x-6 gap-y-0 px-5 py-4">
        <ConfigRow label="siteCommissionBps" value={`${config.siteCommissionBps} (${formatBps(config.siteCommissionBps)})`} />
        <ConfigRow label="disputeFee" value={formatAda(config.disputeFee)} />
        <ConfigRow label="registrationFee" value={formatAda(config.registrationFee)} />
        <ConfigRow label="collateral" value={formatAda(config.collateral)} />
        <ConfigRow label="maxDisputeLosses" value={String(config.maxDisputeLosses)} />
      </div>

      {onUpdate && (
        <footer className="px-5 py-3 border-t border-[var(--line)] flex justify-end bg-[var(--paper-2)]">
          <button
            onClick={onUpdate}
            className="px-3.5 py-2 rounded-[10px] text-[12px] font-semibold border border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)] hover:bg-black"
          >
            Actualizar config · UpdateCompanyConfig
          </button>
        </footer>
      )}
    </article>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline border-b border-dashed border-[var(--line)] py-2.5">
      <span className="font-mono text-[12px] text-[var(--muted)]">{label}</span>
      <span className="font-mono text-[13px] text-[var(--ink)] font-semibold">{value}</span>
    </div>
  );
}
