// WalletButton.tsx — botón del Navbar con 3 estados: desconectado / conectando / conectado.

import * as React from 'react';
import { useWallet } from '@meshsdk/react';
import { WalletModal } from './WalletModal';

const FALLBACK_BY_WALLET: Record<string, { color: string; glyph: string }> = {
  lace:   { color: '#1d3aff', glyph: '⌬' },
  eternl: { color: '#0033ad', glyph: '∞' },
  nami:   { color: '#349ea3', glyph: '🌊' },
  yoroi:  { color: '#3154cb', glyph: '◈' },
  flint:  { color: '#ec5e29', glyph: '🔥' },
  typhon: { color: '#197cef', glyph: '⚡' },
};

export function WalletButton() {
  const { connected, connecting, disconnect, name, address } = useWallet();
  const [modalOpen, setModalOpen] = React.useState(false);
  const [menuOpen, setMenuOpen]   = React.useState(false);
  const [copied, setCopied]       = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen]);

  // ── Conectando ──────────────────────────────────────────────────
  if (connecting && !connected) {
    return (
      <>
        <button disabled className="inline-flex items-center gap-2 px-4 py-2 rounded-full border-[1.5px] border-[var(--line-strong)] bg-[var(--paper)] text-[var(--ink-2)] text-[14px] font-medium cursor-not-allowed">
          <Spinner />
          Conectando…
        </button>
        <WalletModal open={modalOpen} onClose={() => setModalOpen(false)} />
      </>
    );
  }

  // ── Conectado ───────────────────────────────────────────────────
  if (connected) {
    const walletKey = (name ?? '').toLowerCase();
    const fb = FALLBACK_BY_WALLET[walletKey] ?? { color: '#1a1a17', glyph: '◉' };

    return (
      <div ref={wrapperRef} className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="inline-flex items-center gap-2.5 pl-1.5 pr-3.5 py-1.5 rounded-full border border-[var(--line-strong)] bg-[var(--paper)] text-[var(--ink)] text-[13px] font-medium hover:border-[var(--ink-2)] transition-colors"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          {/* Wallet avatar */}
          <span className="relative">
            <span
              className="w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold text-[var(--paper)]"
              style={{ background: fb.color }}
              aria-hidden="true"
            >
              {fb.glyph}
            </span>
            {/* Green connected dot */}
            <span className="absolute -bottom-[1px] -right-[1px] w-2.5 h-2.5 rounded-full bg-[#4d9669] border-[1.5px] border-[var(--paper)]" />
          </span>
          <span className="font-mono text-[12px] text-[var(--ink-2)]">{shortAddr(address)}</span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={['text-[var(--muted)] -ml-0.5 transition-transform', menuOpen ? 'rotate-180' : ''].join(' ')} aria-hidden="true">
            <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>

        {menuOpen && (
          <div role="menu" className="absolute top-[calc(100%+8px)] right-0 z-30 min-w-[240px] p-1.5 bg-[var(--paper)] border border-[var(--line-strong)] rounded-xl shadow-[0_1px_2px_rgba(20,16,8,.04),0_6px_18px_rgba(20,16,8,.06)]">
            <div className="px-3 pt-2.5 pb-1.5 flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)] font-semibold">
                Conectado con {capitalize(name ?? walletKey)}
              </span>
              <span className="font-mono text-[11px] text-[var(--ink-2)] break-all leading-[1.35]">{address}</span>
            </div>
            <div className="h-px bg-[var(--line)] mx-1.5 my-1" />

            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                if (!address) return;
                try {
                  await navigator.clipboard.writeText(address);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                } catch { /* ignore */ }
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium text-[var(--ink)] hover:bg-[var(--paper-2)] text-left"
            >
              <CopyIcon />
              {copied ? '¡Copiada!' : 'Copiar dirección'}
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => { disconnect(); setMenuOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium text-[var(--rose-ink)] hover:bg-[var(--rose-bg)] text-left"
            >
              <DisconnectIcon />
              Desconectar
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Desconectado ────────────────────────────────────────────────
  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="group inline-flex items-center gap-2 px-4 py-2 rounded-full border-[1.5px] border-[var(--accent)] bg-[var(--paper)] text-[var(--accent)] text-[14px] font-semibold cursor-pointer transition-colors hover:bg-[var(--accent)] hover:text-white"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="transition-transform group-hover:translate-x-[1px]" aria-hidden="true">
          <path d="M2 4.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 14 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7z" stroke="currentColor" strokeWidth="1.4" />
          <path d="M11 8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Conectar wallet
      </button>
      <WalletModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}

function Spinner() {
  return (
    <>
      <style>{`@keyframes wb-spin { to { transform: rotate(360deg); } }`}</style>
      <span className="inline-block w-[14px] h-[14px] rounded-full border-[1.5px] border-[var(--line-strong)] border-t-[var(--accent)]" style={{ animation: 'wb-spin .8s linear infinite' }} />
    </>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M11 4V3a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function DisconnectIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9 3H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h5M11 5l3 3-3 3M14 8H7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function shortAddr(addr: string | undefined): string {
  if (!addr) return '';
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 9)}…${addr.slice(-4)}`;
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
