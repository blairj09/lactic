// Matches: counts hard efforts above threshold.
//
// Racers talk about "burning matches": each surge well above threshold (an attack, a short climb,
// closing a gap) costs something you only have a few of. Here a match starts when 3-second power
// reaches 120% of FTP and ends once power has been back under FTP for 5 seconds. Efforts shorter
// than 10 seconds don't count, so a single pedal spike isn't a match. Change the constants to taste.
//
// It's a small state machine: "idle" until a surge starts, "burning" while it lasts.
import { definePlugin, type KitNode } from "@lactic/sdk";

const START = 1.2; // share of FTP that starts a match
const END = 1.0; // share of FTP to fall under to end it
const END_AFTER = 5; // seconds under END before it ends
const MIN_LENGTH = 10; // seconds; shorter surges don't count

interface Match {
  start: number;
  length: number;
  avg: number;
}

/** Feeds one sample at a time; calls `done` for each finished match. Used live and after the ride. */
class Detector {
  private burning = false;
  private start = 0;
  // The effort so far (joules and seconds), and the easy tail after it that may yet end it.
  private sum = 0;
  private n = 0;
  private tailSum = 0;
  private tailN = 0;
  constructor(private done: (m: Match) => void) {}
  push(t: number, power: number, ftp: number, dt: number) {
    if (!this.burning) {
      if (power >= ftp * START) {
        this.burning = true;
        this.start = t;
        this.sum = power * dt;
        this.n = dt;
        this.tailSum = this.tailN = 0;
      }
      return;
    }
    if (power < ftp * END) {
      this.tailSum += power * dt;
      this.tailN += dt;
      if (this.tailN >= END_AFTER) this.finish();
    } else {
      // Back above FTP: the short easy bit was part of the effort after all.
      this.sum += this.tailSum + power * dt;
      this.n += this.tailN + dt;
      this.tailSum = this.tailN = 0;
    }
  }
  finish() {
    if (!this.burning) return;
    this.burning = false;
    if (this.n >= MIN_LENGTH) this.done({ start: this.start, length: this.n, avg: this.sum / this.n });
  }
  get active() {
    return this.burning;
  }
}

function clock(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

// ---- Live field ----
let count = 0;
let last: Match | null = null;
let live = new Detector((m) => {
  count++;
  last = m;
});
let lastTick: number | null = null;
let lastElapsed = 0;

definePlugin({
  field(input) {
    const ftp = input.metrics["profile.ftp"];
    const power = input.metrics["power.3s"];
    const elapsed = input.metrics["ride.elapsed"] ?? 0;
    if (elapsed < lastElapsed) {
      // A new ride: start counting again.
      count = 0;
      last = null;
      live = new Detector((m) => {
        count++;
        last = m;
      });
    }
    lastElapsed = elapsed;
    const dt = lastTick === null ? 1 : Math.min(5, Math.max(0, input.now - lastTick));
    lastTick = input.now;
    if (!ftp) return { tree: { type: "field", label: "Matches", value: "–", sub: "needs your FTP", tone: "muted" } };
    if (power != null) live.push(elapsed, power, ftp, dt);
    const shown = last as Match | null;
    const tree: KitNode = {
      type: "field",
      label: "Matches",
      value: String(count),
      sub: live.active ? "burning one" : shown ? `last ${Math.round(shown.length)} s at ${Math.round(shown.avg)} W` : `over ${Math.round(ftp * START)} W`,
      tone: live.active ? "warn" : "default",
    };
    return { tree, metrics: { count } };
  },

  analyze(input) {
    const ride = input.ride;
    const ftp = input.metrics["profile.ftp"];
    if (!ride?.watts || !ftp) return { tree: { type: "text", text: "Needs a ride with power and your FTP.", tone: "muted" } };
    const dt = ride.stepSeconds;
    const found: Match[] = [];
    const d = new Detector((m) => found.push(m));
    // Smooth to 3 seconds first, like the live field, so one spike doesn't start a match.
    const n = Math.max(1, Math.round(3 / dt));
    let sum = 0;
    ride.watts.forEach((w, i) => {
      sum += (w ?? 0) - (i >= n ? (ride.watts![i - n] ?? 0) : 0);
      d.push(i * dt, sum / Math.min(n, i + 1), ftp, dt);
    });
    d.finish();
    if (!found.length) return { tree: { type: "text", text: `No efforts over ${Math.round(ftp * START)} W for ${MIN_LENGTH} s or more.`, tone: "muted" }, metrics: { ride_count: 0 } };
    return {
      tree: {
        type: "stack",
        children: [
          { type: "stat", label: "Matches burned", value: String(found.length), sub: `efforts over ${Math.round(ftp * START)} W` },
          { type: "bars", values: found.slice(0, 400).map((m) => Math.round(m.avg)) },
          {
            type: "table",
            columns: ["#", "At", "Length", "Power", "% FTP"],
            align: ["left", "left", "right", "right", "right"],
            rows: found.slice(0, 200).map((m, i) => [String(i + 1), clock(m.start), `${Math.round(m.length)} s`, `${Math.round(m.avg)} W`, `${Math.round((m.avg / ftp) * 100)}%`]),
          },
        ],
      },
      metrics: { ride_count: found.length },
    };
  },
});
