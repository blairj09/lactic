// What the web app's code reads from process.env, from Lactic's settings: the built-in coach is on
// when the rider chose it and set up a model. Keys stay in the keychain; the web code only sees
// placeholders.

import { env } from "./globals";
import { coachSetup } from "~/ai/settings";

export async function applyEnv() {
  const setup = await coachSetup();
  if (setup.mode === "builtin" && setup.chat) {
    env.OPENROUTER_API_KEY = "keychain:ai";
    env.OPENROUTER_MODEL = setup.chat.model;
    env.OPENROUTER_VISION_MODEL = setup.vision?.model ?? setup.chat.model;
  } else {
    delete env.OPENROUTER_API_KEY;
    delete env.OPENROUTER_MODEL;
    delete env.OPENROUTER_VISION_MODEL;
  }
}
