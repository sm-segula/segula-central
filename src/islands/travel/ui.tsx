/**
 * Design-system primitives for the travel request island, ported from the
 * SEGULA Portal DS bundle (Input, Textarea, Button, IconButton, StatusBadge,
 * StatTile, Toast, Modal, Dropzone, IconCircle). Styles: travel.css (`tr-*`).
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import Icon, { type IconName } from '../icons';

/* ---------- Fields ---------- */

function Helper({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <div id={id} class="tr-helper">
      <Icon name="circle-alert" size={14} color="var(--brand-pink)" />
      <span>{error}</span>
    </div>
  );
}

interface InputProps {
  label: string;
  value: string;
  onInput: (v: string) => void;
  type?: 'text' | 'email' | 'date';
  required?: boolean;
  error?: string;
  icon?: IconName;
  suffix?: string;
  inputMode?: 'decimal' | 'text' | 'email';
  readOnly?: boolean;
  autoComplete?: string;
}

export function Input({ label, value, onInput, type = 'text', required, error, icon, suffix, inputMode, readOnly, autoComplete }: InputProps) {
  const id = useId();
  const [focus, setFocus] = useState(false);
  // Date inputs always show their mask, so their label stays floated.
  const floated = focus || value.length > 0 || type === 'date';
  return (
    <div class="tr-field-wrap">
      <div class={`tr-field${focus ? ' is-focus' : ''}${error ? ' is-error' : ''}${readOnly ? ' is-readonly' : ''}`}>
        {icon && (
          <span class="tr-field-icon">
            <Icon name={icon} size={20} />
          </span>
        )}
        <label for={id} class={`tr-label${floated ? ' is-floated' : ''}${icon ? ' has-icon' : ''}`}>
          {required ? `${label} *` : label}
        </label>
        <input
          id={id}
          type={type}
          value={value}
          inputMode={inputMode}
          readOnly={readOnly}
          autoComplete={autoComplete}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-h` : undefined}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onInput={(e) => onInput(e.currentTarget.value)}
          class={`tr-input${icon ? ' has-icon' : ''}${suffix ? ' has-suffix' : ''}`}
        />
        {suffix && <span class="tr-suffix">{suffix}</span>}
      </div>
      <Helper id={`${id}-h`} error={error} />
    </div>
  );
}

interface TextareaProps {
  label: string;
  value: string;
  onInput: (v: string) => void;
  rows?: number;
  error?: string;
}

export function Textarea({ label, value, onInput, rows = 3, error }: TextareaProps) {
  const id = useId();
  const [focus, setFocus] = useState(false);
  const floated = focus || value.length > 0;
  return (
    <div class="tr-field-wrap">
      <div
        class={`tr-field tr-field--multi${focus ? ' is-focus' : ''}${error ? ' is-error' : ''}`}
        style={{ minHeight: `${rows * 24 + 40}px` }}
      >
        <label for={id} class={`tr-label tr-label--multi${floated ? ' is-floated' : ''}`}>{label}</label>
        <textarea
          id={id}
          rows={rows}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-h` : undefined}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onInput={(e) => onInput(e.currentTarget.value)}
          class="tr-textarea"
        />
      </div>
      <Helper id={`${id}-h`} error={error} />
    </div>
  );
}

/* ---------- Actions ---------- */

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'md' | 'sm';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ComponentChildren;
}

export function Button({ variant = 'primary', size = 'md', icon, loading, disabled, onClick, children }: ButtonProps) {
  return (
    <button
      type="button"
      class={`tr-btn tr-btn--${variant} tr-btn--${size}`}
      disabled={loading || disabled}
      aria-busy={loading || undefined}
      onClick={onClick}
    >
      {loading ? <span class="tr-spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={20} /> : null}
      <span class="tr-btn-label">{children}</span>
    </button>
  );
}

export function IconButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button type="button" class="tr-iconbtn" aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} size={20} />
    </button>
  );
}

/** Two or more mutually exclusive options (radio group styled as a pill switch). */
export function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div class="tr-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === value}
          class={`tr-seg-opt${o === value ? ' is-active' : ''}`}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/* ---------- Data ---------- */

export type Status = 'pending' | 'partial' | 'complete' | 'error' | 'info';
const STATUS: Record<Status, { icon: IconName; c: string; bg: string }> = {
  pending: { icon: 'clock', c: '#93A4BC', bg: 'rgba(147,164,188,0.10)' },
  partial: { icon: 'circle-dashed', c: '#FFBF00', bg: 'rgba(255,191,0,0.10)' },
  complete: { icon: 'circle-check', c: '#5BBA6F', bg: 'rgba(91,186,111,0.12)' },
  error: { icon: 'circle-alert', c: '#B9348B', bg: 'rgba(185,52,139,0.16)' },
  info: { icon: 'info', c: '#008FD5', bg: 'rgba(0,143,213,0.12)' },
};

export function StatusBadge({ status, children }: { status: Status; children: ComponentChildren }) {
  const s = STATUS[status];
  return (
    <span class="tr-badge" style={{ background: s.bg, borderColor: `${s.c}66` }}>
      <Icon name={s.icon} size={14} color={s.c} />
      {children}
    </span>
  );
}

export function IconCircle({ name, size = 40, color = 'var(--brand-lightblue)' }: { name: IconName; size?: number; color?: string }) {
  return (
    <span class="tr-iconcircle" style={{ width: `${size}px`, height: `${size}px` }}>
      <Icon name={name} size={Math.round(size * 0.5)} color={color} />
    </span>
  );
}

export function StatTile(props: { value: string; unit: string; label: string; caption: string; icon: IconName }) {
  return (
    <div class="tr-stat">
      <span class="tr-stat-icon"><Icon name={props.icon} size={24} /></span>
      <div class="tr-stat-value">
        <span>{props.value}</span>
        <span class="tr-stat-unit">{props.unit}</span>
      </div>
      <div class="tr-stat-label">{props.label}</div>
      <div class="tr-stat-caption">{props.caption}</div>
    </div>
  );
}

/* ---------- Feedback / overlays ---------- */

export type Tone = 'info' | 'success' | 'warning' | 'error';
const TONES: Record<Tone, { icon: IconName; c: string }> = {
  info: { icon: 'info', c: 'var(--brand-lightblue)' },
  success: { icon: 'circle-check', c: 'var(--brand-green)' },
  warning: { icon: 'triangle-alert', c: 'var(--brand-yellow)' },
  error: { icon: 'circle-alert', c: 'var(--brand-pink)' },
};

export function Toast({ tone, title, children, onClose }: { tone: Tone; title: string; children: ComponentChildren; onClose: () => void }) {
  const t = TONES[tone];
  return (
    <div class="tr-toast" role={tone === 'error' ? 'alert' : 'status'}>
      <span class="tr-toast-icon"><Icon name={t.icon} size={20} color={t.c} /></span>
      <div class="tr-toast-body">
        <strong>{title}</strong>
        <span>{children}</span>
      </div>
      <button type="button" class="tr-close tr-close--toast" aria-label="Cerrar" onClick={onClose}>
        <Icon name="x" size={18} />
      </button>
    </div>
  );
}

/**
 * Blocking loader with the current step, for waits on the network or the PDF
 * build, so the page never looks frozen. Announced to screen readers.
 */
export function Loader({ message }: { message: string }) {
  return (
    <div class="tr-overlay tr-overlay--loader" role="status" aria-live="polite">
      <div class="tr-loader">
        <span class="tr-spinner tr-spinner--lg" aria-hidden="true" />
        <span class="tr-loader-text">{message}</span>
      </div>
    </div>
  );
}

/** Without `onClose` the modal cannot be dismissed (no close button, Esc or backdrop). */
export function Modal({ open, title, width = 560, onClose, children }: { open: boolean; title: string; width?: number; onClose?: () => void; children: ComponentChildren }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    // Focus the first input when there is one (the access gate), else the panel.
    (panel.current?.querySelector<HTMLElement>('input') ?? panel.current)?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div class="tr-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={panel} class="tr-modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} style={{ width: `${width}px` }}>
        <div class="tr-modal-head">
          <div class="tr-modal-title">
            <h2>{title}</h2>
            <span class="tr-rule" aria-hidden="true" />
          </div>
          {onClose && (
            <button type="button" class="tr-close" aria-label="Cerrar" onClick={onClose}>
              <Icon name="x" size={20} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Dropzone({ title, hint, onFiles }: { title: string; hint: string; onFiles: (files: FileList) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const open = (): void => input.current?.click();
  return (
    <div
      class={`tr-drop${over ? ' is-over' : ''}`}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer?.files.length) onFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const el = e.currentTarget;
          if (el.files?.length) onFiles(el.files);
          el.value = '';
        }}
      />
      <IconCircle name={over ? 'download' : 'cloud-upload'} size={56} />
      <div class="tr-drop-text">
        <span class="tr-drop-title">{over ? 'Suelta para subir' : title}</span>
        <span class="tr-drop-hint">
          o <span class="tr-drop-link">selecciona un archivo</span> · {hint}
        </span>
      </div>
    </div>
  );
}
