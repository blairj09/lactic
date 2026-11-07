// node:zlib's gunzipSync for the browser (intervals.icu sends some files gzipped).
import { gunzipSync as gunzip } from "fflate";

export function gunzipSync(data: Uint8Array): Uint8Array {
  return gunzip(data);
}
