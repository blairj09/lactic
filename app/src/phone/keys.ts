// The rider's API keys (the coach's AI key, intervals.icu) following them between the iPhone and
// the computer, so they type each one once. The keys travel only inside the sealed link (phone.rs
// answers "keys" in Rust, never over the iCloud mailbox) and land in each device's keychain; the
// newer save or delete wins (secrets.rs `plan`). On the computer the web layer never sees a key;
// here on the phone a key the computer asks for passes through for the moment it takes to send it.

import { invoke } from "~/platform/native";
import { send } from "./plugin";

type KeyState = { at: number; set: boolean };
type KeyValue = { at: number; value: string | null };
interface KeysReply {
  take: Record<string, KeyValue>;
  want: string[];
}

/** One round (two when the computer wants a key from here). Returns how many keys changed here. */
export async function syncKeys(): Promise<number> {
  const have = await invoke<Record<string, KeyState>>("secrets_offer");
  let reply = await send<KeysReply>("keys", { have, give: {} }, 30);
  let changed = await take(reply);
  if (reply.want.length) {
    const give = await invoke<Record<string, KeyValue>>("secrets_give", { names: reply.want });
    reply = await send<KeysReply>("keys", { have: await invoke<Record<string, KeyState>>("secrets_offer"), give }, 30);
    changed += await take(reply);
  }
  return changed;
}

async function take(reply: KeysReply): Promise<number> {
  if (!reply.take || !Object.keys(reply.take).length) return 0;
  return invoke<number>("secrets_take", { take: reply.take });
}
