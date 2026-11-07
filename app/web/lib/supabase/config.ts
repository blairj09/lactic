// Lactic keeps everything in the local SQLite database (src/db), which always exists, so the
// data-backed screens are always on. Nothing here talks to a hosted service.

export const authEnabled = true;

/** The one email allowed to sign in. Server-only. */
export function allowedEmail(): string | undefined {
  return process.env.ALLOWED_EMAIL?.trim().toLowerCase() || undefined;
}

export function isAllowedEmail(email: string | undefined | null): boolean {
  const allowed = allowedEmail();
  return Boolean(allowed && email && email.trim().toLowerCase() === allowed);
}

/** Server-only key for minting sign-in codes. Set it in Production only, so preview builds never hold it. */
export function supabaseSecretKey(): string | undefined {
  return process.env.SUPABASE_SECRET_KEY?.trim() || undefined;
}

/**
 * The passkey relying party: the domain passkeys are bound to. It must match Authentication > Passkeys in
 * Supabase, and never change once a passkey exists.
 */
export const PASSKEY_RP_ID = "coach.jamesblair.me";

/** Whether a passkey can sign in on this host (a Host header, maybe with a port). Previews on vercel.app can't. */
export function passkeysWorkOn(host: string | null | undefined, rpId = PASSKEY_RP_ID): boolean {
  const name = host?.trim().toLowerCase().replace(/:\d+$/, "");
  return Boolean(name && (name === rpId || name.endsWith(`.${rpId}`)));
}
