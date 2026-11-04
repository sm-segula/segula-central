import { REQ, money, total, fmtSize, type Currency, type Field } from './travel/model';
import { useTravelRequest } from './travel/useTravelRequest';
import {
  Button, Checkbox, Dropzone, IconButton, IconCircle, Input, Modal, Segmented, StatTile, StatusBadge, Textarea, Toast,
} from './travel/ui';
import Icon from './icons';

const CURRENCIES = ['MXN', 'USD'] as const;
const CURRENCY_NAME: Record<Currency, string> = {
  MXN: 'pesos mexicanos (MXN)',
  USD: 'dólares estadounidenses (USD)',
  EUR: 'euros (EUR)',
};

interface Props {
  currency?: Currency;
  folioPrefix?: string;
  /** Apps Script web app that issues folios; without it a per-browser counter is used. */
  folioEndpoint?: string;
}

/**
 * SEGULA Travel: travel request & authorization form. Fills the request,
 * attaches receipts and downloads one PDF with a unique folio. Port of the
 * Claude Design prototype "Solicitud de Viajes". Styles: travel/travel.css.
 */
export default function TravelRequest({ currency: initialCurrency = 'MXN', folioPrefix = 'STRA-VJ', folioEndpoint }: Props) {
  const s = useTravelRequest(initialCurrency, folioPrefix, folioEndpoint);
  const { f, errors: err, currency } = s;
  const totalFmt = money(total(s));
  const n = s.files.length;
  const summary = `${n === 0 ? 'Sin adjuntos' : n === 1 ? '1 adjunto' : `${n} adjuntos`} · Total $ ${totalFmt} ${currency}`;

  // Shorthand for a bound single-line field.
  const field = (k: Field, label: string, opts: { required?: boolean; type?: 'text' | 'email' | 'date'; icon?: 'map-pin'; wide?: boolean; readOnly?: boolean } = {}) => (
    <div data-field={k} class={opts.wide ? 'tr-span' : undefined}>
      <Input
        label={label}
        type={opts.type}
        required={opts.required}
        readOnly={opts.readOnly}
        icon={opts.icon}
        value={f[k]}
        error={err[k]}
        onInput={(v) => s.setField(k, v)}
      />
    </div>
  );

  return (
    <div class="tr">
      <header class="tr-head">
        <div class="tr-head-text">
          <span class="sc-tag" data-reveal>Solicitud de viajes · Travel request</span>
          <h1 class="tr-title" data-reveal data-reveal-delay="70">
            Solicitud de <span class="sc-kw">viaje</span> y autorización
          </h1>
          <span class="tr-rule tr-rule--lg" aria-hidden="true" data-reveal data-reveal-delay="140" />
          <p class="tr-sub" data-reveal data-reveal-delay="210">
            Llena los campos, adjunta tus comprobantes y descarga un solo PDF con folio único. Los campos con * son obligatorios.
          </p>
        </div>
        <div class="tr-folio" data-reveal data-reveal-delay="140">
          <span class="tr-folio-label">Folio</span>
          <span class="tr-folio-value">{s.folio || '—'}</span>
          {s.issued ? (
            <StatusBadge status="complete">Emitido</StatusBadge>
          ) : s.folio ? (
            <StatusBadge status="info">Reservado</StatusBadge>
          ) : (
            <StatusBadge status="pending">{s.reserving ? 'Asignando…' : 'Por asignar'}</StatusBadge>
          )}
        </div>
      </header>

      <section class="tr-panel" aria-labelledby="tr-p1">
        <h2 id="tr-p1" class="tr-panel-title">01 · Datos de la solicitud</h2>
        <div class="tr-grid">
          {field('requestDate', 'Fecha de solicitud', { type: 'date' })}
          {field('employeeName', 'Nombre completo del empleado', { required: true })}
          {field('employeeNumber', 'Número de empleado / TID', { required: true })}
          {field('email', 'Correo SEGULA', { required: true, type: 'email', readOnly: true })}
          {field('clientProject', 'Cliente / proyecto', { required: true })}
          {field('po', 'PO a facturar')}
          <div data-field="objective" class="tr-span">
            <Textarea label="Objetivo del viaje *" value={f.objective} error={err.objective} onInput={(v) => s.setField('objective', v)} />
          </div>
        </div>
        <div class="tr-grid tr-grid--gap">
          {field('departureDate', 'Fecha de salida', { required: true, type: 'date' })}
          {field('returnDate', 'Fecha de regreso', { required: true, type: 'date' })}
          {field('origin', 'Origen del viaje', { required: true })}
          {field('destination', 'Destino', { required: true })}
          {field('returnDestination', 'Destino de regreso')}
          {field('destinationAddress', 'Dirección del destino', { icon: 'map-pin', wide: true })}
        </div>
        <span class="tr-auth-tag tr-auth-tag--gap">Jefe directo</span>
        <div class="tr-grid tr-grid--auth">
          {field('managerName', 'Nombre del jefe directo', { required: true })}
          {field('managerPosition', 'Puesto del jefe directo', { required: true })}
        </div>
      </section>

      <section class="tr-panel" aria-labelledby="tr-p2">
        <div class="tr-panel-head">
          <h2 id="tr-p2" class="tr-panel-title">02 · Requerimientos especiales</h2>
          <Segmented label="Moneda de los gastos" options={CURRENCIES} value={currency} onChange={s.setCurrency} />
        </div>
        <p class="tr-note">Indica solo lo que necesites. Los costos se suman al total aprobado. Elige la moneda en la que capturas tus gastos.</p>
        <div class="tr-rows">
          {REQ.map((r) => (
            <div class="tr-req" key={r.key}>
              <div class="tr-req-name">
                <Icon name={r.icon} size={20} color="var(--brand-lightblue)" />
                <span>{r.label}</span>
              </div>
              <div class="tr-req-details">
                <Input label="Detalles / instrucciones" value={s.req[r.key].details} onInput={(v) => s.setReqField(r.key, 'details', v)} />
              </div>
              <div class="tr-req-cost">
                <Input label="Costo aprobado" inputMode="decimal" suffix={currency} value={s.req[r.key].cost} onInput={(v) => s.setReqField(r.key, 'cost', v)} />
              </div>
            </div>
          ))}
        </div>
        <div class="tr-total">
          <StatTile value={`$ ${totalFmt}`} unit={currency} label="Total cost approved" caption="Suma de requerimientos especiales" icon="calculator" />
        </div>
      </section>

      <section class="tr-panel" aria-labelledby="tr-p3">
        <h2 id="tr-p3" class="tr-panel-title">03 · Archivos adjuntos</h2>
        <p class="tr-note">
          Opcional. PDF e imágenes se fusionan en el mismo documento; Excel, Word u otros formatos solo se listan en la hoja de anexos.
        </p>
        <Dropzone title="Arrastra tus comprobantes aquí" hint="PDF, JPG, PNG u otros · máx. 25 MB" onFiles={s.addFiles} />
        {n > 0 && (
          <ul class="tr-files">
            {s.files.map((fl) => (
              <li class="tr-file" key={fl.id}>
                <IconCircle name={fl.kind === 'pdf' ? 'file-text' : fl.kind === 'image' ? 'image' : 'file'} />
                <div class="tr-file-meta">
                  <span class="tr-file-name">{fl.name}</span>
                  <span class="tr-file-size">{fmtSize(fl.size)}</span>
                </div>
                <StatusBadge status={fl.kind === 'other' ? 'partial' : 'complete'}>
                  {fl.kind === 'other' ? 'Solo se lista' : fl.kind === 'image' ? 'Se convierte a página' : 'Se fusiona'}
                </StatusBadge>
                <IconButton icon="trash-2" label="Quitar archivo" onClick={() => s.removeFile(fl.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <div class="tr-bar">
        <div class="tr-bar-inner">
          <span class="tr-bar-summary">{summary}</span>
          <div class="tr-bar-actions">
            <Button variant="ghost" icon="rotate-ccw" disabled={s.busyDownload} onClick={s.reset}>Nueva solicitud</Button>
            <Button variant="secondary" icon="eye" loading={s.busyPreview} onClick={s.preview}>Vista previa</Button>
            <Button variant="primary" icon="download" loading={s.busyDownload} onClick={s.requestDownload}>Descargar PDF</Button>
          </div>
        </div>
      </div>

      {s.toast && (
        <div class="tr-toast-slot">
          <Toast tone={s.toast.tone} title={s.toast.title} onClose={s.closeToast}>{s.toast.msg}</Toast>
        </div>
      )}

      <Modal open={s.previewOpen} title="Vista previa del PDF" width={960} onClose={s.closePreview}>
        <div class="tr-preview">
          <iframe title="Vista previa" src={s.previewUrl} class="tr-preview-frame" />
          <div class="tr-preview-actions">
            <Button variant="secondary" onClick={s.closePreview}>Seguir editando</Button>
            <Button variant="primary" icon="download" loading={s.busyDownload} onClick={s.requestDownload}>Descargar PDF</Button>
          </div>
        </div>
      </Modal>

      <Modal open={s.confirmOpen} title="Confirma la moneda de tus gastos" width={560} onClose={s.closeConfirm}>
        <p class="tr-confirm-text">
          Tus gastos se registrarán en <strong>{CURRENCY_NAME[currency]}</strong>. Verifica que todos los costos que capturaste estén en {currency} antes de generar el PDF.
        </p>
        <p class="tr-confirm-total">$ {totalFmt} {currency}</p>
        <div class="tr-confirm-actions">
          <Button variant="secondary" onClick={s.closeConfirm}>Cambiar moneda</Button>
          <Button variant="primary" icon="download" onClick={s.confirmDownload}>Sí, están en {currency}</Button>
        </div>
      </Modal>

      {/* Access gate: no onClose, so it cannot be dismissed. noValidate keeps the
          browser from adding its own hints to the single "Correo incorrecto." */}
      <Modal open={s.gateOpen} title="Acceso a SEGULA Travel" width={480}>
        <form
          class="tr-gate"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            s.enter();
          }}
        >
          <p class="tr-confirm-text">Ingresa tu correo corporativo para continuar.</p>
          <Input label="Correo corporativo" inputMode="email" autoComplete="email" value={s.gateEmail} error={s.gateError} onInput={s.setGateField} />
          <Checkbox label="Recordar correo" checked={s.gateRemember} onChange={s.setGateRemember} />
          <div class="tr-confirm-actions">
            <button type="submit" class="tr-btn tr-btn--primary tr-btn--md">
              <span class="tr-btn-label">Continuar</span>
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
