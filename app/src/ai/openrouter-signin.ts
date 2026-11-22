// Sign in with OpenRouter: OpenRouter's PKCE sign-in makes a key for Lactic, so the rider doesn't
// copy one by hand. The Rust core (src-tauri/src/openrouter.rs) makes the code verifier, swaps the
// code for the key with OpenRouter directly and puts the key in the keychain; the web layer never
// sees it, the same as a pasted key.
//
// OpenRouter sends the browser back to lactic.fit/openrouter/ (site/openrouter/index.html), a
// static page that passes the one-time code on to the app: to 127.0.0.1 on a computer, to
// lactic://lactic.fit/openrouter on the iPhone. The code is no use without the verifier, which
// never leaves the device, and lactic.fit keeps nothing.

import { invoke, isDesktop, isPhone } from "~/platform/native";
import { webAuth } from "~/phone/plugin";

/** Whether this build can sign in (the app; a browser during development pastes a key). */
export const canSignIn = () => isDesktop;

/** Opens OpenRouter's sign-in and saves the key it makes. Resolves once the key is in the keychain. */
export async function signInWithOpenRouter(): Promise<void> {
  if (!isDesktop) throw new Error("Sign in works in the Lactic app. Paste a key instead.");
  if (!isPhone()) return invoke<void>("openrouter_connect");
  const { url } = await invoke<{ url: string }>("openrouter_begin");
  const back = await webAuth(url, "lactic");
  const q = readReturn(back.url);
  await invoke<void>("openrouter_finish", q);
}

/** Stops a computer sign-in still waiting for the browser. */
export async function cancelOpenRouterSignIn() {
  if (isDesktop && !isPhone()) await invoke<void>("openrouter_cancel").catch(() => {});
}

/** The code and state from the address the iPhone's sign-in sheet came back to. */
export function readReturn(url: string): { code: string; state: string } {
  let back: URL;
  try {
    back = new URL(url);
  } catch {
    throw new Error("OpenRouter sent back something unexpected. Try again.");
  }
  const code = back.searchParams.get("code");
  const state = back.searchParams.get("state");
  if (!code || !state) throw new Error("OpenRouter didn't finish the sign-in. Try again.");
  return { code, state };
}
