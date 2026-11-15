// What the web app's code reads from process.env, from Lactic's settings: the built-in coach is on
// when the rider chose it, set up a model and saved a key (when the provider needs one). Keys stay in the keychain; the web code only sees
// placeholders.

import { env } from "./globals";
import { builtinReady, coachSetup, mcpOn, SECRET_AI } from "~/ai/settings";
import { secretStatus } from "~/platform/secrets";
import { invoke, isDesktop } from "~/platform/native";

export async function applyEnv() {
  const setup = await coachSetup();
  const keySaved = setup.mode === "builtin" && setup.provider?.hasKey ? Boolean(await secretStatus(SECRET_AI).catch(() => null)) : false;
  if (builtinReady(setup, keySaved) && setup.chat) {
    env.OPENROUTER_API_KEY = "keychain:ai";
    env.OPENROUTER_MODEL = setup.chat.model;
    env.OPENROUTER_VISION_MODEL = setup.vision?.model ?? setup.chat.model;
  } else {
    delete env.OPENROUTER_API_KEY;
    delete env.OPENROUTER_MODEL;
    delete env.OPENROUTER_VISION_MODEL;
  }
  // The MCP server answers only when the rider chose an external coach, or AI apps alongside the built-in one.
  if (isDesktop) await invoke("mcp_set_enabled", { enabled: mcpOn(setup) }).catch(console.error);
}
