// WalletModal.tsx — modal CIP-30 propio que reemplaza <CardanoWallet /> de Mesh.

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { useWallet } from '@meshsdk/react';
import { BrowserWallet } from '@meshsdk/core';

interface WalletDef {
  key: string;
  name: string;
  site: string;
  fallback: { color: string; glyph: string };
}

const WALLETS: WalletDef[] = [
  { key: 'lace',   name: 'Lace',   site: 'https://www.lace.io',      fallback: { color: '#1d3aff', glyph: '⌬' } },
  { key: 'eternl', name: 'Eternl', site: 'https://eternl.io',        fallback: { color: '#0033ad', glyph: '∞' } },
  { key: 'nami',   name: 'Nami',   site: 'https://namiwallet.io',    fallback: { color: '#349ea3', glyph: '🌊' } },
  { key: 'yoroi',  name: 'Yoroi',  site: 'https://yoroi-wallet.com', fallback: { color: '#3154cb', glyph: '◈' } },
  { key: 'flint',  name: 'Flint',  site: 'https://flint-wallet.com', fallback: { color: '#ec5e29', glyph: '🔥' } },
  { key: 'typhon', name: 'Typhon', site: 'https://typhonwallet.io',  fallback: { color: '#197cef', glyph: '⚡' } },
];

export interface WalletModalProps {
  open: boolean;
  onClose: () => void;
}

type ErrorState =
  | { kind: 'network'; message: string }
  | { kind: 'rejected'; message: string }
  | { kind: 'other'; message: string }
  | null;

export function WalletModal({ open, onClose }: WalletModalProps) {
  const { connect, connected, connecting, name: currentName } = useWallet();
  const [installed, setInstalled] = React.useState<Record<string, { icon?: string }>>({});
  const [connectingKey, setConnectingKey] = React.useState<string | null>(null);
  const [error, setError] = React.useState<ErrorState>(null);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setConnectingKey(null);
    try {
      const list = BrowserWallet.getInstalledWallets() as Array<{ name: string; icon?: string }>;
      const map: Record<string, { icon?: string }> = {};
      for (const w of list) map[w.name.toLowerCase()] = { icon: w.icon };
      setInstalled(map);
    } catch {
      setInstalled({});
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  React.useEffect(() => {
    if (open && connected && connectingKey) {
      setConnectingKey(null);
      onClose();
    }
  }, [open, connected, connectingKey, onClose]);

  const handleConnect = async (walletKey: string) => {
    setError(null);
    setConnectingKey(walletKey);
    try {
      await connect(walletKey);
    } catch (e) {
      setConnectingKey(null);
      setError(classifyError(e));
    }
  };

  if (!open) return null;

  return ReactDOM.createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-modal-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto py-6 bg-[rgba(26,26,23,0.40)] backdrop-blur-[3px] animate-[wm-fade_180ms_ease]"
    >
      <style>{`
        @keyframes wm-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes wm-pop  { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes wm-spin { to { transform: rotate(360deg); } }
        @keyframes wm-pulse { 50% { opacity: .45; } }
        .wm-spinner { width: 14px; height: 14px; border: 1.5px solid var(--line-strong); border-top-color: var(--accent); border-radius: 50%; animation: wm-spin .8s linear infinite; display: inline-block; }
      `}</style>

      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] mx-6 rounded-[18px] overflow-hidden bg-[var(--paper)] border border-[var(--line)] shadow-[0_4px_12px_rgba(20,16,8,.08),0_20px_60px_rgba(20,16,8,.18)] animate-[wm-pop_220ms_cubic-bezier(.2,.7,.3,1)]"
      >
        <header className="relative px-6 pt-[22px] pb-3.5">
          <h2 id="wallet-modal-title" className="m-0 mb-1 text-[18px] font-semibold tracking-[-0.012em]">
            Conectá tu wallet
          </h2>
          <p className="m-0 text-[13px] text-[var(--muted)] leading-[1.4]">
            Seleccioná una wallet CIP-30 compatible.
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="absolute top-[18px] right-[18px] w-8 h-8 grid place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--paper-2)] hover:text-[var(--ink)] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {error && <ErrorBanner error={error} />}

        <div className="px-3 pb-3 pt-1 flex flex-col gap-0.5">
          {WALLETS.map((w) => (
            <WalletRow
              key={w.key}
              def={w}
              installedIcon={installed[w.key]?.icon}
              isInstalled={w.key in installed}
              isConnecting={connecting && connectingKey === w.key}
              isCurrent={connected && currentName?.toLowerCase() === w.key}
              disabled={!!connectingKey && connectingKey !== w.key}
              onConnect={() => handleConnect(w.key)}
            />
          ))}
        </div>

        <footer className="px-6 py-[14px] pb-[18px] border-t border-[var(--line)] bg-[var(--paper-2)] flex items-center gap-2 text-[12px] text-[var(--muted)]">
          <span
            className="w-[7px] h-[7px] rounded-full bg-[#4d9669] shadow-[0_0_0_3px_rgba(77,150,105,.22)]"
            style={{ animation: 'wm-pulse 1.8s ease-in-out infinite' }}
          />
          <span>
            <strong className="font-semibold">Solo Preview testnet</strong>
            <span className="mx-1.5 text-[var(--line-strong)]">·</span>
            Red principal no soportada
          </span>
        </footer>
      </div>
    </div>,
    document.body
  );
}

function WalletRow({
  def, installedIcon, isInstalled, isConnecting, isCurrent, disabled, onConnect,
}: {
  def: WalletDef; installedIcon?: string; isInstalled: boolean;
  isConnecting: boolean; isCurrent: boolean; disabled: boolean; onConnect: () => void;
}) {
  return (
    <div className={['relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors', isConnecting ? 'bg-[var(--paper-2)]' : 'hover:bg-[var(--paper-2)]'].join(' ')}>
      {isCurrent && <span className="absolute left-0 top-3.5 bottom-3.5 w-[3px] rounded bg-[#4d9669]" aria-hidden="true" />}

      <WalletIcon def={def} iconBase64={installedIcon} />

      <span className={['flex-1 min-w-0 flex items-center gap-2 text-[14px] font-medium', isInstalled ? 'text-[var(--ink)]' : 'text-[var(--muted)]'].join(' ')}>
        {isCurrent && (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0" aria-hidden="true">
            <circle cx="8" cy="8" r="7" fill="#d8ecde" />
            <path d="M5 8l2 2 4-4" stroke="#4d9669" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {def.name}
      </span>

      {isCurrent ? (
        <span className="px-3 py-1.5 rounded-lg border border-[#4d9669] bg-[var(--paper)] text-[#244d33] text-[13px] font-semibold">
          Conectado
        </span>
      ) : isConnecting ? (
        <button disabled className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--line-strong)] bg-[var(--paper)] text-[var(--ink-2)] text-[13px] font-semibold cursor-not-allowed">
          <span className="wm-spinner" />
          Conectando…
        </button>
      ) : isInstalled ? (
        <button
          type="button"
          onClick={onConnect}
          disabled={disabled}
          className={['px-3 py-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-deep)] text-white text-[13px] font-semibold transition-colors', disabled ? 'opacity-50 cursor-not-allowed' : ''].join(' ')}
        >
          Conectar
        </button>
      ) : (
        <a href={def.site} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--paper-2)] border border-[var(--line)] hover:border-[var(--line-strong)] text-[var(--muted)] hover:text-[var(--ink-2)] text-[11px] font-semibold">
          No instalada
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M3 1h6v6M9 1L3 7M1 9h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      )}
    </div>
  );
}

function WalletIcon({ def, iconBase64 }: { def: WalletDef; iconBase64?: string }) {
  return (
    <span
      className="shrink-0 w-9 h-9 rounded-[10px] border border-[var(--line)] grid place-items-center text-[18px] overflow-hidden"
      style={iconBase64 ? { background: 'var(--paper)' } : { background: def.fallback.color + '22', color: def.fallback.color }}
      aria-hidden="true"
    >
      {iconBase64 ? <img src={iconBase64} alt="" className="w-full h-full object-cover" /> : def.fallback.glyph}
    </span>
  );
}

function ErrorBanner({ error }: { error: ErrorState }) {
  if (!error) return null;
  const isAmber = error.kind === 'network';
  return (
    <div role="alert" className={['mx-6 mb-3.5 flex items-start gap-2.5 px-[13px] py-[11px] rounded-[10px] text-[13px] leading-[1.4]', isAmber ? 'bg-[var(--amber-bg)] text-[var(--amber-ink)] border border-[#ebd187]' : 'bg-[var(--rose-bg)] text-[var(--rose-ink)] border border-[#ecb5ac]'].join(' ')}>
      {error.kind === 'network' ? (
        <svg className="shrink-0 mt-[1px]" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 1l7 13H1L8 1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M8 6v3.5M8 11.5h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ) : (
        <svg className="shrink-0 mt-[1px]" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )}
      <span>
        <strong className="font-semibold">{error.kind === 'network' ? 'Red incorrecta.' : error.kind === 'rejected' ? 'Conexión cancelada.' : 'Error.'}</strong>
        {error.message ? <> {error.message}</> : null}
      </span>
    </div>
  );
}

function classifyError(e: unknown): ErrorState {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Error desconocido.';
  const lower = msg.toLowerCase();
  if (lower.includes('network') || lower.includes('mainnet') || lower.includes('wrong network') || lower.includes('preview'))
    return { kind: 'network', message: 'Cambiá tu wallet a Preview testnet y volvé a intentar.' };
  if (lower.includes('reject') || lower.includes('denied') || lower.includes('cancel') || lower.includes('user refused'))
    return { kind: 'rejected', message: '' };
  return { kind: 'other', message: msg };
}
