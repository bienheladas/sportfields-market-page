import * as React from 'react';
import { NavLink } from 'react-router-dom';
import { useWallet } from '@meshsdk/react';
import { WalletButton } from './WalletButton';

export function Navbar() {
  const { connected } = useWallet();

  return (
    <header className="sticky top-0 z-40 bg-[rgba(248,244,236,0.85)] backdrop-blur-md border-b border-[var(--line)]">
      <div className="max-w-[1280px] mx-auto px-8 max-sm:px-[18px] h-16 flex items-center gap-6">
        <Brand />

        <nav className="flex gap-0.5">
          <NavItem to="/" end>Canchas</NavItem>
          {connected && <NavItem to="/bookings">Mis reservas</NavItem>}
          {connected && <NavItem to="/owner">Mi panel</NavItem>}
        </nav>

        <div className="flex-1" />
        <WalletButton />
      </div>
    </header>
  );
}

function NavItem({ to, end, children }: { to: string; end?: boolean; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          'px-3 py-[7px] rounded-lg text-[14px] font-medium no-underline transition-colors',
          isActive ? 'bg-[var(--paper-2)] text-[var(--ink)]' : 'text-[var(--ink-2)] hover:bg-[var(--paper-2)]',
        ].join(' ')
      }
    >
      {children}
    </NavLink>
  );
}

function Brand() {
  return (
    <NavLink to="/" className="flex items-center gap-2.5 font-bold text-base tracking-[-0.01em] text-[var(--ink)] no-underline">
      <span
        className="relative w-7 h-7 rounded-[9px] shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_1px_2px_rgba(0,0,0,0.08)]"
        style={{ background: 'radial-gradient(circle at 32% 30%, #ff8d76 0%, var(--accent) 58%, #c8442a 100%)' }}
        aria-hidden="true"
      >
        <span className="absolute inset-[6px] rounded border-y-0 border-x-[1.5px] border-white/60" />
      </span>
      Sportfields
    </NavLink>
  );
}
