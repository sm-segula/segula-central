import { REQ, money, total, fmtSize, type Currency, type Field } from './travel/model';
import { useTravelRequest } from './travel/useTravelRequest';
import {
  Button, Dropzone, IconButton, IconCircle, Input, Modal, StatTile, StatusBadge, Textarea, Toast,
} from './travel/ui';
import Icon from './icons';

interface Props {
  currency?: Currency;
  folioPrefix?: string;
}

/**
 * SEGULA Travel: travel request & authorization form. Fills the request,
 * attaches receipts and downloads one PDF with a unique folio. Port of the
 * Claude Design prototype "Solicitud de Viajes". Styles: travel/travel.css.
 */
export default function TravelRequest({ currency = 'MXN', folioPrefix = 'SEG-VJ' }: Props) {
  const s = useTravelRequest(currency, folioPrefix);
  const { f, errors: err } = s;
  const totalFmt = money(total(s));
  const n = s.files.length;
  const summary = `${n === 0 ? 'Sin adjuntos' : n === 1 ? '1 adjunto' : `${n} adjuntos`} · Total $ ${totalFmt} ${currency}`;

  // Shorthand for a bound single-line field.
  const field = (k: Field, label: string, opts: { required?: boolean; type?: 'text' | 'email' | 'date'; icon?: 'map-pin'; wide?: boolean } = {}) => (
    <div data-field={k} class={opts.wide ? 'tr-span' : undefined}>
      <Input
        label={label}
        type={opts.type}
        required={opts.required}
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
          <StatusBadge status={s.issued ? 'complete' : 'pending'}>{s.issued ? 'Emitido' : 'Reservado'}</StatusBadge>
        </div>
      </header>

      <section class="tr-panel" aria-labelledby="tr-p1">
        <h2 id="tr-p1" class="tr-panel-title">01 · Datos de la solicitud</h2>
        <div class="tr-grid">
          {field('requestDate', 'Fecha de solicitud', { type: 'date' })}
          {field('employeeName', 'Nombre del empleado', { required: true })}
          {field('employeeNumber', 'Número de empleado / TID', { required: true })}
          {field('email', 'Correo SEGULA', { required: true, type: 'email' })}
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
      </section>

      <section class="tr-panel" aria-labelledby="tr-p2">
        <h2 id="tr-p2" class="tr-panel-title">02 · Requerimientos especiales</h2>
        <p class="tr-note">Indica solo lo que necesites. Los costos se suman al total aprobado.</p>
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
      </section>

      <section class="tr-panel" aria-labelledby="tr-p3">
        <h2 id="tr-p3" class="tr-panel-title">03 · Autorización</h2>
        <span class="tr-auth-tag">Jefe directo</span>
        <div class="tr-grid tr-grid--auth">
          {field('managerName', 'Nombre del jefe directo', { required: true })}
          {field('managerPosition', 'Puesto del jefe directo', { required: true })}
        </div>
        <div class="tr-total">
          <StatTile value={`$ ${totalFmt}`} unit={currency} label="Total cost approved" caption="Suma de requerimientos especiales" icon="calculator" />
        </div>
      </section>

      <section class="tr-panel" aria-labelledby="tr-p4">
        <h2 id="tr-p4" class="tr-panel-title">04 · Archivos adjuntos</h2>
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
            <Button variant="ghost" icon="rotate-ccw" onClick={s.reset}>Nueva solicitud</Button>
            <Button variant="secondary" icon="eye" loading={s.busyPreview} onClick={s.preview}>Vista previa</Button>
            <Button variant="primary" icon="download" loading={s.busyDownload} onClick={s.download}>Descargar PDF</Button>
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
            <Button variant="primary" icon="download" loading={s.busyDownload} onClick={s.download}>Descargar PDF</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
