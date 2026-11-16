// Row ids that every device works out the same way, for plugin rows that two devices can each write
// for the same thing (the same plugin, the same ride's analysis or number). A paired iPhone and its
// computer then write one row, and sync keeps the newer, instead of two rows fighting over one key.

/** A UUID-shaped id from the SHA-256 of `parts`, always the same for the same parts. */
export async function stableId(...parts: string[]): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lactic:${parts.join("\u0000")}`))).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80; // version 8: custom
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
