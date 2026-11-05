import { useEffect, useRef, useState } from 'preact/hooks';
import { normalizeEmail } from '../lib/auth/email.ts';
import { safeNext } from '../lib/auth/routes.ts';
import './login/login.css';

type Step = 'email' | 'code';

const COOLDOWN_SECONDS = 60;

const MESSAGES: Record<string, string> = {
  invalid_email: 'Correo incorrecto.',
  invalid_code: 'Código incorrecto o vencido.',
  expired: 'Código incorrecto o vencido.',
  too_many_attempts: 'Demasiados intentos. Pide un código nuevo.',
  cooldown: 'Espera un momento antes de pedir otro código.',
  busy: 'El servicio está ocupado. Intenta de nuevo en unos segundos.',
  not_configured: 'El inicio de sesión no está disponible por ahora.',
};
const GENERIC = 'No pudimos completar la solicitud. Intenta de nuevo.';

async function post(path: string, body: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
    return (await res.json()) as { ok: boolean; error?: string };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export default function LoginForm() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  async function requestCode(): Promise<boolean> {
    const normalized = normalizeEmail(email);
    if (!normalized) {
      setError(MESSAGES.invalid_email!);
      return false;
    }
    setBusy(true);
    setError('');
    const r = await post('/auth/request', { email: normalized });
    setBusy(false);
    if (r.ok) {
      setEmail(normalized);
      setCooldown(COOLDOWN_SECONDS);
      return true;
    }
    setError(MESSAGES[r.error ?? ''] ?? GENERIC);
    return false;
  }

  async function onEmail(e: Event) {
    e.preventDefault();
    if (busy) return;
    if (await requestCode()) {
      setCode('');
      setStep('code');
    }
  }

  async function onCode(e: Event) {
    e.preventDefault();
    if (busy) return;
    if (!/^\d{6}$/.test(code)) {
      setError(MESSAGES.invalid_code!);
      return;
    }
    setBusy(true);
    setError('');
    const r = await post('/auth/verify', { email, code });
    if (r.ok) {
      const next = safeNext(new URLSearchParams(location.search).get('next'));
      location.replace(next);
      return;
    }
    setBusy(false);
    setError(MESSAGES[r.error ?? ''] ?? GENERIC);
  }

  async function onResend() {
    if (busy || cooldown > 0) return;
    if (await requestCode()) setCode('');
  }

  if (step === 'email') {
    return (
      <form class="login-card" onSubmit={onEmail} noValidate>
        <h1 class="login-title">Inicia sesión</h1>
        <p class="login-copy">Escribe tu correo corporativo y te enviaremos un código de acceso.</p>
        <label class="login-label" htmlFor="login-email">Correo corporativo</label>
        <input
          id="login-email"
          class="login-input"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          placeholder="nombre@segulagrp.com"
          value={email}
          onInput={(e) => setEmail(e.currentTarget.value)}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'login-error' : undefined}
          required
        />
        {error && <p id="login-error" class="login-error" role="alert">{error}</p>}
        <button class="login-button" type="submit" disabled={busy}>
          {busy ? 'Enviando…' : 'Enviar código'}
        </button>
      </form>
    );
  }

  return (
    <form class="login-card" onSubmit={onCode} noValidate>
      <h1 class="login-title">Revisa tu correo</h1>
      <p class="login-copy">
        Enviamos un código de 6 dígitos a <strong>{email}</strong>. Vence en 10 minutos.
      </p>
      <label class="login-label" htmlFor="login-code">Código de acceso</label>
      <input
        id="login-code"
        ref={codeRef}
        class="login-input login-code"
        type="text"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        placeholder="000000"
        value={code}
        onInput={(e) => setCode(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? 'login-error' : undefined}
        required
      />
      {error && <p id="login-error" class="login-error" role="alert">{error}</p>}
      <button class="login-button" type="submit" disabled={busy || code.length !== 6}>
        {busy ? 'Verificando…' : 'Entrar'}
      </button>
      <div class="login-links">
        <button type="button" class="login-link" onClick={onResend} disabled={busy || cooldown > 0}>
          {cooldown > 0 ? `Reenviar código (${cooldown} s)` : 'Reenviar código'}
        </button>
        <button
          type="button"
          class="login-link"
          onClick={() => {
            setStep('email');
            setError('');
          }}
        >
          Usar otro correo
        </button>
      </div>
    </form>
  );
}
