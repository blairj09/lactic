// A random id for this device, kept outside the database, so plugin approvals (plugin_grants) are
// per device (review S7): a restored backup or a synced phone carries the rows but not this id, so
// nothing it brings runs until the rider approves it here. Losing the id only switches plugins off.
const KEY = "lactic.device-id";
let memory: string | null = null;

export function deviceId(): string {
  if (memory) return memory;
  try {
    const have = localStorage.getItem(KEY);
    if (have && /^[0-9a-f-]{36}$/.test(have)) return (memory = have);
    const id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
    return (memory = id);
  } catch {
    return (memory = crypto.randomUUID());
  }
}

/** Tests: pretend to be another device. */
export function setDeviceIdForTests(id: string | null) {
  memory = id;
}
