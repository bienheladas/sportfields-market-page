import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useLucid } from '../lib/LucidContext';

import { useRegisterOwner, type RegisterOwnerFields } from '../hooks/useRegisterOwner';
import { useOwnerFields } from '../hooks/useOwnerFields';
import { WalletModal } from '../components/WalletModal';
import { timezoneFromLatLong } from '../lib/timezone';

const LIMITS = { fieldName: 64, fieldAddress: 64, phone: 32, email: 64 } as const;
const LATLONG_RE = /^-?\d+\.\d+$/;
const CARDANOSCAN_URL = 'https://preview.cardanoscan.io/transaction';

const INITIAL_FIELDS: RegisterOwnerFields = {
  fieldName: '',
  fieldAddress: '',
  phone: '',
  email: '',
  lat: '',
  long_: '',
  timezone: '',  // derivado de lat/long, no del navegador — ver FormStep
};

type Step = 'form' | 'preview' | 'success';

export default function RegisterOwner() {
  const navigate = useNavigate();
  const { connected, pkh } = useLucid();
  const { register, loading, error } = useRegisterOwner();

  const viewerPkh = pkh || null;
  const { fields: existingFields } = useOwnerFields(connected ? viewerPkh : null);

  const [step, setStep] = React.useState<Step>('form');
  const [fields, setFields] = React.useState<RegisterOwnerFields>(INITIAL_FIELDS);
  const [txHash, setTxHash] = React.useState<string | null>(null);
  const [walletModalOpen, setWalletModalOpen] = React.useState(false);

  const handleConfirm = async () => {
    try {
      const hash = await register(fields);
      setTxHash(hash);
      setStep('success');
    } catch {
      // error queda en el hook → se muestra en el banner inline
    }
  };

  return (
    <PageShell>
      <BackLink onClick={() => (step === 'form' ? navigate('/') : setStep('form'))} />

      <Stepper step={step} />

      {step === 'form' && (
        <>
          <Heading
            title="Registra tu cancha en Sportfields"
            lede="Una vez registrada, podrás definir precios e inicializar slots semanales. La info se guarda on-chain como parte de tu Owner NFT."
          />
          {existingFields.length > 0 && (
            <Banner tone="amber" className="mb-6">
              Ya tienes {existingFields.length} cancha{existingFields.length > 1 ? 's' : ''} registrada{existingFields.length > 1 ? 's' : ''}. Puedes registrar otra con una nueva transacción.
            </Banner>
          )}
          <FormStep
            fields={fields}
            onChange={setFields}
            onContinue={() => setStep('preview')}
            connected={connected}
            onConnectWallet={() => setWalletModalOpen(true)}
          />
        </>
      )}

      {step === 'preview' && (
        <>
          <Heading
            title="Revisá antes de firmar"
            lede="Esta transacción acuña tu Owner NFT y lo deposita en el contrato con un min-UTxO de 2 ADA. La firma se hace desde tu wallet."
          />
          <PreviewStep
            fields={fields}
            onBack={() => setStep('form')}
            onConfirm={handleConfirm}
            submitting={loading}
            error={error}
          />
        </>
      )}

      {step === 'success' && txHash && (
        <SuccessStep
          txHash={txHash}
          onGoToPanel={() => navigate('/owner')}
          onGoHome={() => navigate('/')}
        />
      )}

      <WalletModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="max-w-[840px] mx-auto px-8 max-sm:px-[18px] py-12 pb-20">
      {children}
    </main>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 mb-6 px-2.5 py-1.5 rounded-lg text-[13px] text-[var(--muted)] hover:bg-[var(--paper-2)] hover:text-[var(--ink)]"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Volver
    </button>
  );
}

function Heading({ title, lede }: { title: string; lede: string }) {
  return (
    <>
      <h1 className="m-0 mb-2 text-[36px] font-bold tracking-[-0.025em] leading-[1.05]">{title}</h1>
      <p className="m-0 mb-9 text-base text-[var(--muted)] max-w-[540px] leading-snug">{lede}</p>
    </>
  );
}

const STEP_ORDER: Step[] = ['form', 'preview', 'success'];

function Stepper({ step }: { step: Step }) {
  const current = STEP_ORDER.indexOf(step);
  const items: { key: Step; label: string }[] = [
    { key: 'form', label: 'Datos del campo' },
    { key: 'preview', label: 'Revisar y pagar' },
    { key: 'success', label: 'Confirmado' },
  ];
  return (
    <div className="flex items-center gap-1.5 mb-9 text-[12px] text-[var(--muted)]">
      {items.map((it, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'idle';
        return (
          <React.Fragment key={it.key}>
            <span
              className={[
                'inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full border font-medium',
                state === 'active'
                  ? 'bg-[var(--ink)] text-[var(--paper)] border-[var(--ink)]'
                  : state === 'done'
                  ? 'bg-[var(--paper)] border-[var(--mint-deep,#4d9669)] text-[var(--mint-ink,#244d33)]'
                  : 'bg-[var(--paper)] border-[var(--line)] text-[var(--muted)]',
              ].join(' ')}
            >
              <span
                className={[
                  'w-[18px] h-[18px] grid place-items-center rounded-full font-mono text-[10px] font-semibold',
                  state === 'active'
                    ? 'bg-[var(--paper)] text-[var(--ink)]'
                    : state === 'done'
                    ? 'bg-[var(--mint-deep,#4d9669)] text-white'
                    : 'bg-[var(--line)] text-[var(--ink)]',
                ].join(' ')}
              >
                {state === 'done' ? '✓' : i + 1}
              </span>
              {it.label}
            </span>
            {i < items.length - 1 && <span className="w-[18px] h-px bg-[var(--line)]" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function FormStep({
  fields,
  onChange,
  onContinue,
  connected,
  onConnectWallet,
}: {
  fields: RegisterOwnerFields;
  onChange: (next: RegisterOwnerFields) => void;
  onContinue: () => void;
  connected: boolean;
  onConnectWallet: () => void;
}) {
  // timezone se deriva de lat/long, no se pide a mano — pedirlo manualmente
  // llevó a que quedara con el timezone del navegador de quien registró
  // (Intl.DateTimeFormat().resolvedOptions().timeZone), sin relación con la
  // ubicación real de la cancha. Se recalcula en el propio setter de lat/long,
  // no en un efecto, para no desincronizarse del valor recién tipeado.
  const set = <K extends keyof RegisterOwnerFields>(k: K, v: string) => {
    const next = { ...fields, [k]: v };
    if (k === 'lat' || k === 'long_') {
      next.timezone = LATLONG_RE.test(next.lat) && LATLONG_RE.test(next.long_)
        ? timezoneFromLatLong(parseFloat(next.lat), parseFloat(next.long_))
        : '';
    }
    onChange(next);
  };

  const valid = isFormValid(fields);

  return (
    <div className="bg-[var(--paper)] border border-[var(--line)] rounded-2xl shadow-[0_1px_2px_rgba(20,16,8,.04),0_6px_18px_rgba(20,16,8,.06)] overflow-hidden">
      <header className="px-6 pt-5 pb-4 border-b border-[var(--line)]">
        <h2 className="m-0 text-[18px] font-semibold tracking-[-0.012em]">Datos del campo</h2>
        <p className="m-0 mt-0.5 text-[13px] text-[var(--muted)]">
          Todos los campos se guardan en el datum on-chain del OwnerRecord.
        </p>
      </header>
      <div className="px-6 py-5 pb-6">
        <TextField
          id="fieldName"
          label="Nombre del campo"
          value={fields.fieldName}
          onChange={(v) => set('fieldName', v)}
          placeholder="Cancha Norte El Prado"
          maxBytes={LIMITS.fieldName}
          hint="Cómo aparece en la búsqueda."
        />
        <TextField
          id="fieldAddress"
          label="Dirección"
          value={fields.fieldAddress}
          onChange={(v) => set('fieldAddress', v)}
          placeholder="Av. Principal 123, Caracas"
          maxBytes={LIMITS.fieldAddress}
          hint="Calle y número, ciudad."
        />
        <div className="grid grid-cols-2 max-[560px]:grid-cols-1 gap-3.5">
          <TextField
            id="phone"
            label="Teléfono"
            type="tel"
            value={fields.phone}
            onChange={(v) => set('phone', v)}
            placeholder="+58 412 555 0101"
            maxBytes={LIMITS.phone}
            hint="Solo dígitos y +."
          />
          <TextField
            id="email"
            label="Email"
            type="email"
            value={fields.email}
            onChange={(v) => set('email', v)}
            placeholder="reservas@cancha.ve"
            maxBytes={LIMITS.email}
            hint="Contacto para reservas."
          />
        </div>
        <div className="grid grid-cols-2 max-[560px]:grid-cols-1 gap-3.5">
          <TextField
            id="lat"
            label="Latitud"
            value={fields.lat}
            onChange={(v) => set('lat', v)}
            placeholder="10.4806"
            mono
            hint="Decimal con punto. Ej: -34.6037."
            error={fields.lat !== '' && !LATLONG_RE.test(fields.lat) ? 'Formato inválido' : null}
          />
          <TextField
            id="long_"
            label="Longitud"
            value={fields.long_}
            onChange={(v) => set('long_', v)}
            placeholder="-66.9036"
            mono
            hint="Decimal con punto. Ej: -58.3816."
            error={fields.long_ !== '' && !LATLONG_RE.test(fields.long_) ? 'Formato inválido' : null}
          />
        </div>
        <div className="flex flex-col gap-1.5 mb-3.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--muted)] font-semibold">
            Zona horaria (derivada de lat/long)
          </span>
          <div className="px-3 py-2 rounded-[8px] border border-dashed border-[var(--line-strong)] bg-[var(--paper-2)] text-[13px] font-mono text-[var(--ink-2)]">
            {fields.timezone || 'Ingresá latitud y longitud válidas'}
          </div>
          <span className="text-[11px] text-[var(--muted)]">
            Se calcula automáticamente de las coordenadas — define la hora local de tu horario semanal (init-week).
          </span>
        </div>

        <Banner tone="mint" className="mt-2">
          Tu Owner NFT (token name = PKH de tu wallet) prueba la propiedad de la cancha. Solo tú puedes actualizar estos datos después con <strong>Tx 10</strong>.
        </Banner>
      </div>

      <footer className="px-6 py-4 pb-5 border-t border-[var(--line)] bg-[var(--paper-2)] flex gap-2.5 items-center">
        {!connected ? (
          <button
            type="button"
            onClick={onConnectWallet}
            className="ml-auto px-[18px] py-3 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-deep)] text-white font-semibold text-[14px] inline-flex items-center gap-2"
          >
            Conectar wallet para continuar
          </button>
        ) : (
          <button
            type="button"
            onClick={onContinue}
            disabled={!valid}
            className={[
              'ml-auto px-[18px] py-3 rounded-[10px] font-semibold text-[14px] inline-flex items-center gap-2',
              valid
                ? 'bg-[var(--accent)] hover:bg-[var(--accent-deep)] text-white'
                : 'bg-[var(--paper-3)] text-[var(--muted)] cursor-not-allowed',
            ].join(' ')}
          >
            Continuar
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </footer>
    </div>
  );
}

function PreviewStep({
  fields,
  onBack,
  onConfirm,
  submitting,
  error,
}: {
  fields: RegisterOwnerFields;
  onBack: () => void;
  onConfirm: () => void;
  submitting: boolean;
  error: string | null;
}) {
  return (
    <>
      <div className="bg-[var(--paper)] border border-[var(--line)] rounded-2xl shadow-[0_1px_2px_rgba(20,16,8,.04),0_6px_18px_rgba(20,16,8,.06)] overflow-hidden mb-4.5">
        <header className="px-6 pt-5 pb-4 border-b border-[var(--line)]">
          <h2 className="m-0 text-[18px] font-semibold tracking-[-0.012em]">Datos a registrar on-chain</h2>
          <p className="m-0 mt-0.5 text-[13px] text-[var(--muted)]">
            Verificá que la información sea correcta — después de firmar se vuelve inmutable hasta una Tx 10.
          </p>
        </header>
        <div className="px-6 py-5">
          <SummaryRow k="Nombre" v={fields.fieldName} />
          <SummaryRow k="Dirección" v={fields.fieldAddress} />
          <SummaryRow k="Teléfono" v={fields.phone} mono />
          <SummaryRow k="Email" v={fields.email} mono />
          <SummaryRow k="Coordenadas" v={`${fields.lat}, ${fields.long_}`} mono />
          <SummaryRow k="Zona horaria" v={fields.timezone} mono />
          <SummaryRow k="Owner NFT" v="policyId + PKH (28 B token name)" mono />
        </div>
      </div>

      <div className="bg-[var(--paper)] border border-[var(--line)] rounded-2xl shadow-[0_1px_2px_rgba(20,16,8,.04),0_6px_18px_rgba(20,16,8,.06)] overflow-hidden">
        <header className="px-6 pt-5 pb-4 border-b border-[var(--line)]">
          <h2 className="m-0 text-[18px] font-semibold tracking-[-0.012em]">Costos de la transacción</h2>
          <p className="m-0 mt-0.5 text-[13px] text-[var(--muted)]">
            Tx 2 — Register Owner. Detalle de cada movimiento de ADA.
          </p>
        </header>
        <div className="px-6 py-5">
          <Banner tone="mint" className="mb-4">
            El <strong>min-UTxO de 2 ADA</strong> queda bloqueado en el contrato junto al Owner NFT y es recuperable. La <strong>fee de 5 ADA</strong> y la fee de red no son recuperables.
          </Banner>

          <ul className="m-0 p-0 list-none flex flex-col gap-0">
            <CostRow label="Min-UTxO del script output" sub="Recuperable · queda en OwnersValidator junto al Owner NFT" v="2.00 ₳" />
            <CostRow label="Registration fee" sub="No recuperable · va a la company" v="5.00 ₳" />
            <CostRow label="Fee de red (estimada)" sub="No recuperable · pagada al pool" v="~ 0.50 ₳" />
            <CostRow label="Total a debitar de tu wallet" sub="2 ADA recuperables después" v="~ 7.50 ₳" total />
          </ul>

          {error && (
            <div className="mt-4 flex items-start gap-2.5 p-3 px-3.5 rounded-[10px] bg-[var(--rose-bg)] border border-[#ecb5ac] text-[var(--rose-ink,#6f2920)] text-[13px] leading-snug">
              <svg className="shrink-0 mt-px" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
                <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <div>
                <strong className="font-semibold">No se pudo registrar.</strong>
                <div className="mt-1 font-mono text-[11px] break-all">{error}</div>
              </div>
            </div>
          )}
        </div>
        <footer className="px-6 py-4 pb-5 border-t border-[var(--line)] bg-[var(--paper-2)] flex gap-2.5 items-center flex-wrap">
          <button
            type="button"
            onClick={onBack}
            disabled={submitting}
            className="px-[18px] py-3 rounded-[10px] bg-[var(--paper)] border border-[var(--line-strong)] hover:border-[var(--ink)] text-[var(--ink)] font-semibold text-[14px] disabled:opacity-50"
          >
            ← Editar datos
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className={[
              'ml-auto px-[18px] py-3 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-deep)] text-white font-semibold text-[14px] inline-flex items-center gap-2',
              submitting ? 'opacity-70 cursor-wait' : '',
            ].join(' ')}
          >
            {submitting ? (
              <>
                <Spinner />
                Firmando…
              </>
            ) : error ? (
              <>
                Reintentar
                <ArrowRight />
              </>
            ) : (
              <>
                Confirmar y firmar · Tx 2
                <ArrowRight />
              </>
            )}
          </button>
        </footer>
      </div>
    </>
  );
}

function SuccessStep({
  txHash,
  onGoToPanel,
  onGoHome,
}: {
  txHash: string;
  onGoToPanel: () => void;
  onGoHome: () => void;
}) {
  return (
    <div className="bg-[var(--paper)] border border-[var(--line)] rounded-2xl shadow-[0_1px_2px_rgba(20,16,8,.04),0_6px_18px_rgba(20,16,8,.06)]">
      <div className="px-7 py-9">
        <div className="w-[72px] h-[72px] mx-auto mb-5 rounded-full bg-[var(--mint-bg)] grid place-items-center text-[var(--mint-deep,#4d9669)]">
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="16" stroke="currentColor" strokeWidth="1.6" />
            <path d="M12 18l4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="m-0 mb-2 text-[24px] font-bold tracking-[-0.015em] text-center">¡Cancha registrada!</h2>
        <p className="m-0 mb-6 text-center text-[var(--muted)] text-[14px] max-w-[420px] mx-auto leading-snug">
          Tu Owner NFT está acuñado y depositado en el contrato. Ahora puedes inicializar los 168 slots semanales desde tu panel.
        </p>

        <div className="bg-[var(--paper-2)] border border-[var(--line)] rounded-[10px] px-4 py-3.5 mb-5 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-[0.06em] text-[var(--muted)] font-semibold mb-1">
              Tx Hash
            </div>
            <div className="font-mono text-[13px] text-[var(--ink)] break-all">{txHash}</div>
          </div>
          <a
            href={`${CARDANOSCAN_URL}/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] text-[var(--ink-2)] font-semibold no-underline border-b border-dashed border-[var(--line-strong)] hover:text-[var(--accent)] hover:border-[var(--accent)] whitespace-nowrap"
          >
            CardanoScan ↗
          </a>
        </div>

        <div className="flex gap-2.5 justify-center flex-wrap">
          <button
            type="button"
            onClick={onGoToPanel}
            className="px-[18px] py-3 rounded-[10px] bg-[var(--ink)] hover:bg-[var(--ink-2)] text-[var(--paper)] font-semibold text-[14px]"
          >
            Ir a mi panel
          </button>
          <button
            type="button"
            onClick={onGoHome}
            className="px-[18px] py-3 rounded-[10px] bg-[var(--paper)] border border-[var(--line-strong)] hover:border-[var(--ink)] text-[var(--ink)] font-semibold text-[14px]"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  maxBytes,
  hint,
  mono,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  maxBytes?: number;
  hint?: string;
  mono?: boolean;
  error?: string | null;
}) {
  const bytes = utf8Bytes(value);
  const over = maxBytes ? bytes > maxBytes : false;
  const invalid = over || !!error;

  return (
    <div className="flex flex-col gap-1.5 mb-4.5">
      <label htmlFor={id} className="text-[11px] uppercase tracking-[0.06em] text-[var(--muted)] font-bold">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className={[
          'px-3.5 py-[11px] bg-[var(--paper)] border rounded-[10px] text-[15px] text-[var(--ink)]',
          'transition-[border-color,box-shadow] duration-100',
          mono ? 'font-mono' : '',
          invalid
            ? 'border-[var(--rose-ink,#6f2920)] focus:outline-none focus:shadow-[0_0_0_3px_rgba(111,41,32,.08)]'
            : 'border-[var(--line-strong)] focus:outline-none focus:border-[var(--ink)] focus:shadow-[0_0_0_3px_rgba(26,26,23,.08)]',
        ].join(' ')}
      />
      <div className="flex justify-between items-center text-[12px] text-[var(--muted)]">
        <span>{error ?? hint ?? ' '}</span>
        {maxBytes != null && (
          <span className={['font-mono', over ? 'text-[var(--rose-ink,#6f2920)] font-semibold' : ''].join(' ')}>
            {bytes} / {maxBytes} B
          </span>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-2 text-[14px] border-b border-[var(--line)] last:border-b-0">
      <span className="text-[var(--muted)] text-[12px] uppercase tracking-[0.06em] font-semibold pt-px">
        {k}
      </span>
      <span className={['text-[var(--ink)] font-medium break-words', mono ? 'font-mono text-[13px]' : ''].join(' ')}>
        {v || <span className="text-[var(--muted)] font-normal">—</span>}
      </span>
    </div>
  );
}

function CostRow({
  label,
  sub,
  v,
  total,
}: {
  label: string;
  sub?: string;
  v: string;
  total?: boolean;
}) {
  return (
    <li
      className={[
        'flex justify-between items-baseline py-2.5 gap-3',
        total ? 'pt-3 border-t border-[var(--line)] mt-1' : 'border-b border-dashed border-[var(--line)] last-of-type:border-b-0',
      ].join(' ')}
    >
      <div className="flex flex-col gap-px min-w-0">
        <span className={['text-[14px]', total ? 'font-bold text-[15px]' : 'font-medium'].join(' ')}>
          {label}
        </span>
        {sub && <span className="text-[11px] text-[var(--muted)]">{sub}</span>}
      </div>
      <span
        className={[
          'font-mono font-semibold whitespace-nowrap',
          total ? 'text-[17px] text-[var(--accent-deep,#d44a2f)]' : 'text-[14px]',
        ].join(' ')}
      >
        {v}
      </span>
    </li>
  );
}

function Banner({
  tone = 'mint',
  className = '',
  children,
}: {
  tone?: 'mint' | 'amber' | 'rose';
  className?: string;
  children: React.ReactNode;
}) {
  const toneCls = {
    mint: 'bg-[var(--mint-bg)] text-[var(--mint-ink,#244d33)] border-[#b9d8c1]',
    amber: 'bg-[var(--amber-bg)] text-[var(--amber-ink,#6b4d10)] border-[#ebd187]',
    rose: 'bg-[var(--rose-bg)] text-[var(--rose-ink,#6f2920)] border-[#ecb5ac]',
  }[tone];
  return (
    <p className={['m-0 flex items-start gap-2.5 p-3 px-3.5 rounded-[10px] text-[12px] leading-snug border', toneCls, className].join(' ')}>
      <svg className="shrink-0 mt-px" width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

function Spinner() {
  return (
    <>
      <style>{`@keyframes ro-spin { to { transform: rotate(360deg); } }`}</style>
      <span
        className="inline-block w-[14px] h-[14px] rounded-full border-[1.5px] border-white/40 border-t-white"
        style={{ animation: 'ro-spin .8s linear infinite' }}
      />
    </>
  );
}

function ArrowRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

function isFormValid(f: RegisterOwnerFields): boolean {
  if (!f.fieldName.trim() || utf8Bytes(f.fieldName) > LIMITS.fieldName) return false;
  if (!f.fieldAddress.trim() || utf8Bytes(f.fieldAddress) > LIMITS.fieldAddress) return false;
  if (!f.phone.trim() || utf8Bytes(f.phone) > LIMITS.phone) return false;
  if (!f.email.trim() || utf8Bytes(f.email) > LIMITS.email) return false;
  if (!LATLONG_RE.test(f.lat)) return false;
  if (!LATLONG_RE.test(f.long_)) return false;
  if (!f.timezone.trim()) return false;
  return true;
}
