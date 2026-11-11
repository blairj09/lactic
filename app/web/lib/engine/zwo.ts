import { ramp, sprint, steady, type Segment, type Workout } from "./workout";

/**
 * Reads a Zwift workout file (.zwo). Uses a small tag scanner rather than DOMParser so it runs
 * the same on the server and in the browser.
 */
export function parseZwo(xml: string): Workout {
  const raw = xml.match(/<name>([\s\S]*?)<\/name>/)?.[1]?.trim();
  const name = raw ? unescapeXml(raw) : "Untitled workout";
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

const unescapeXml = (text: string) =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const share = (fraction: number) => String(Math.round(fraction * 1000) / 1000);

/**
 * Writes a workout as a Zwift workout file (.zwo), which Zwift, TrainerDay, MyWhoosh and most
 * trainer apps open. Reads back through parseZwo as the same workout.
 */
export function writeZwo(workout: Workout): string {
  const segments = workout.segments.filter((s) => s.duration > 0);
  const lines = segments.map((segment, i) => {
    const duration = Math.round(segment.duration);
    switch (segment.kind) {
      case "steady":
        if (segment.allOut) return `    <MaxEffort Duration="${duration}"/>`;
        return `    <SteadyState Duration="${duration}" Power="${share(segment.target)}"/>`;
      case "ramp": {
        // Zwift draws a first ramp as the warm-up and a last one as the cool-down.
        const tag = i === 0 && segment.to >= segment.from ? "Warmup" : i === segments.length - 1 && segment.to < segment.from ? "Cooldown" : "Ramp";
        return `    <${tag} Duration="${duration}" PowerLow="${share(segment.from)}" PowerHigh="${share(segment.to)}"/>`;
      }
      case "freeRide":
        return `    <FreeRide Duration="${duration}"/>`;
    }
  });
  return [
    "<workout_file>",
    "  <author>Lactic</author>",
    `  <name>${escapeXml(workout.name || "Workout")}</name>`,
    "  <description>Made in Lactic (lactic.fit).</description>",
    "  <sportType>bike</sportType>",
    "  <tags/>",
    "  <workout>",
    ...lines,
    "  </workout>",
    "</workout_file>",
    "",
  ].join("\n");
}
