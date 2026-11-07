import { ramp, sprint, steady, type Segment, type Workout } from "./workout";

/**
 * Reads a Zwift workout file (.zwo). Uses a small tag scanner rather than DOMParser so it runs
 * the same on the server and in the browser.
 */
export function parseZwo(xml: string): Workout {
  const name = xml.match(/<name>([\s\S]*?)<\/name>/)?.[1]?.trim() ?? "Untitled workout";
  const body = xml.match(/<workout>([\s\S]*?)<\/workout>/)?.[1];
  if (body === undefined) throw new Error("No <workout> element");

  const segments: Segment[] = [];
  for (const [, tag, attrText] of body.matchAll(/<(\w+)\b([^>]*?)\/?>/g)) {
    const a = attributes(attrText);
    switch (tag) {
      case "Warmup":
      case "Cooldown":
      case "Ramp":
        // PowerLow is where the segment starts and PowerHigh where it ends, so cooldowns run high to low.
        segments.push(ramp(a("Duration"), a("PowerLow"), a("PowerHigh")));
        break;
      case "SteadyState":
        segments.push(steady(a("Duration"), a("Power", a("PowerLow"))));
        break;
      case "IntervalsT":
        for (let i = 0; i < Math.max(Math.floor(a("Repeat", 1)), 1); i++) {
          segments.push(steady(a("OnDuration"), a("OnPower")));
          segments.push(steady(a("OffDuration"), a("OffPower")));
        }
        break;
      case "MaxEffort":
        // Zwift's all-out block: ridden with ERG off, planned at 2x FTP for the chart.
        segments.push(sprint(a("Duration"), 2));
        break;
      case "FreeRide":
      case "Freeride":
        segments.push({ kind: "freeRide", duration: a("Duration") });
        break;
    }
  }
  if (segments.length === 0) throw new Error("Workout has no segments");
  return { name, segments };
}

function attributes(text: string) {
  const values = new Map<string, string>();
  for (const [, key, value] of text.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) values.set(key, value);
  return (key: string, fallback = 0): number => {
    const n = Number(values.get(key));
    return values.has(key) && Number.isFinite(n) ? n : fallback;
  };
}
