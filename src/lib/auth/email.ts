const ALLOWED = /^[a-z0-9._%+-]+@segulagrp\.com$/;

/** Trims and lowercases; returns null unless it is an address at segulagrp.com. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return ALLOWED.test(email) ? email : null;
}
