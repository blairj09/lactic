// Simulated gear, so a rider can try Lactic (and we can test it) with nothing paired: a smart
// trainer (FTMS with ERG and simulation modes), a heart rate strap, a power meter and a Body Pod
// scale. They speak the real GATT packet formats, so everything above them runs unchanged.

import type { Advert, BleBackend, Notification, ServiceInfo } from "./backend";
import { fullUuid } from "./backend";

const S = {
  ftms: fullUuid(0x1826),
  hr: fullUuid(0x180d),
  power: fullUuid(0x1818),
  pod: fullUuid(0xfff0),
};
const C = {
  bike: fullUuid(0x2ad2),
  control: fullUuid(0x2ad9),
  status: fullUuid(0x2ada),
  feature: fullUuid(0x2acc),
  hrm: fullUuid(0x2a37),
  cpm: fullUuid(0x2a63),
  podProfile: fullUuid(0xfff1),
  podSecondary: fullUuid(0xfff2),
  podNotify: fullUuid(0xfff4),
};

interface SimDevice {
  id: string;
  name: string;
  services: ServiceInfo[];
}

const notify = ["notify"];
const DEVICES: SimDevice[] = [
  {
    id: "sim:trainer",
    name: "Lactic Sim Trainer",
    services: [
      {
        uuid: S.ftms,
        characteristics: [
          { uuid: C.bike, properties: notify },
          { uuid: C.control, properties: ["write", "indicate"] },
          { uuid: C.status, properties: notify },
          { uuid: C.feature, properties: ["read"] },
        ],
      },
      { uuid: S.power, characteristics: [{ uuid: C.cpm, properties: notify }] },
    ],
  },
  { id: "sim:hr", name: "Lactic Sim HR", services: [{ uuid: S.hr, characteristics: [{ uuid: C.hrm, properties: notify }] }] },
  { id: "sim:power", name: "Lactic Sim Power", services: [{ uuid: S.power, characteristics: [{ uuid: C.cpm, properties: notify }] }] },
  {
    id: "sim:scale",
    name: "Body Pod (Sim)",
    services: [
      {
        uuid: S.pod,
        characteristics: [
          { uuid: C.podProfile, properties: ["write", "write-without-response"] },
          { uuid: C.podSecondary, properties: notify },
          { uuid: C.podNotify, properties: notify },
        ],
      },
    ],
  },
];

/** The simulated rider: what the sim gear reports. Tweak it from the simulator panel. */
export const simRider = {
  pedaling: true,
  /** Watts the rider pushes when the trainer isn't holding a target. */
  freePower: 170,
  cadence: 90,
  restingHr: 58,
  maxHr: 188,
  weightKg: 72.4,
};

function emitter<T>() {
  const set = new Set<(v: T) => void>();
  return { on: (cb: (v: T) => void) => (set.add(cb), () => void set.delete(cb)), emit: (v: T) => set.forEach((cb) => cb(v)) };
}

const noise = (amp: number) => (Math.random() - 0.5) * 2 * amp;

export function simBackend(): BleBackend {
  const adverts = emitter<Advert>();
  const notes = emitter<Notification>();
  const drops = emitter<string>();
  const connected = new Set<string>();
  const subs = new Set<string>();
  let scanTimer: ReturnType<typeof setInterval> | null = null;
  let tick: ReturnType<typeof setInterval> | null = null;

  // Trainer state.
  let mode: "free" | "erg" | "sim" = "free";
  let target = 0;
  let grade = 0;
  let power = 0;
  let hr = simRider.restingHr;
  let crankRevs = 0;
  let crankTime = 0;
  let crankFrac = 0;

  const key = (id: string, s: string, c: string) => `${id}|${s}|${c}`;
  const send = (id: string, service: string, characteristic: string, value: number[]) => {
    if (connected.has(id) && subs.has(key(id, service, characteristic))) notes.emit({ id, service, characteristic, value });
  };

  function step() {
    const cadence = simRider.pedaling ? simRider.cadence + noise(2) : 0;
    const want = !simRider.pedaling ? 0 : mode === "erg" ? target : mode === "sim" ? Math.max(60, simRider.freePower + grade * 18) : simRider.freePower;
    // Trainers take a couple of seconds to settle on a new target.
    power += (want - power) * 0.35;
    const watts = Math.max(0, Math.round(power + (simRider.pedaling ? noise(6) : 0)));
    const effort = Math.min(1, watts / 320);
    const wantHr = simRider.restingHr + (simRider.maxHr - simRider.restingHr) * (0.25 + 0.6 * effort) * (simRider.pedaling ? 1 : 0.5);
    hr += (wantHr - hr) * 0.04;
    const speedKph = simRider.pedaling ? Math.max(0, 10 + Math.cbrt(watts) * 4.2 - grade * 0.8) : 0;

    // Crank events at the simulated cadence (1/1024 s ticks, wrapping at 16 bits).
    crankFrac += cadence / 60;
    const whole = Math.floor(crankFrac);
    if (whole > 0) {
      crankFrac -= whole;
      crankRevs = (crankRevs + whole) & 0xffff;
      crankTime = (crankTime + Math.round(whole * (60 / Math.max(cadence, 1)) * 1024)) & 0xffff;
    }

    // FTMS indoor bike data: flags 0x0044 (speed, cadence, power).
    const s = Math.round(speedKph * 100);
    const c = Math.round(cadence * 2);
    send("sim:trainer", S.ftms, C.bike, [0x44, 0x00, s & 0xff, s >> 8, c & 0xff, c >> 8, watts & 0xff, (watts >> 8) & 0xff]);
    const cpm = (w: number) => [0x20, 0x00, w & 0xff, (w >> 8) & 0xff, crankRevs & 0xff, crankRevs >> 8, crankTime & 0xff, crankTime >> 8];
    send("sim:trainer", S.power, C.cpm, cpm(watts));
    const pm = Math.max(0, Math.round(watts * 1.02 + noise(4)));
    send("sim:power", S.power, C.cpm, cpm(pm));
    const bpm = Math.round(hr);
    const rr = Math.round((60 / Math.max(bpm, 30)) * 1024);
    send("sim:hr", S.hr, C.hrm, [0x10, bpm, rr & 0xff, rr >> 8]);
  }

  function ensureTick() {
    const riding = ["sim:trainer", "sim:hr", "sim:power"].some((d) => connected.has(d));
    if (riding && !tick) tick = setInterval(step, 1000);
    if (!riding && tick) {
      clearInterval(tick);
      tick = null;
    }
  }

  function controlPoint(value: number[]) {
    const op = value[0];
    const int16 = (i: number) => {
      const v = value[i] | (value[i + 1] << 8);
      return v & 0x8000 ? v - 0x10000 : v;
    };
    if (op === 0x05) {
      mode = "erg";
      target = int16(1);
    } else if (op === 0x11) {
      mode = "sim";
      grade = int16(3) / 100;
    } else if (op === 0x01) {
      mode = "free";
    }
    const known = [0x00, 0x01, 0x04, 0x05, 0x07, 0x08, 0x11].includes(op);
    setTimeout(() => send("sim:trainer", S.ftms, C.control, [0x80, op, known ? 0x01 : 0x02]), 40);
  }

  function weighIn() {
    const final = Math.round((simRider.weightKg + noise(0.3)) * 100);
    const frames = 12;
    for (let i = 1; i <= frames; i++) {
      setTimeout(() => {
        const kg = i === frames ? final : Math.round(final * (0.4 + (0.6 * i) / frames) + noise(40));
        send("sim:scale", S.pod, C.podNotify, [0xcf, 0x00, i === frames ? 0x80 : 0x00, kg & 0xff, kg >> 8]);
      }, i * 250);
    }
    [0, 1].forEach((frequency, n) =>
      setTimeout(() => {
        const ohms = [3200, 3250, 260, 2800, 2850].map((o) => Math.round((o - frequency * 300 + noise(40)) * 1));
        const bytes = ohms.flatMap((o) => [o & 0xff, o >> 8]);
        send("sim:scale", S.pod, C.podNotify, [0xbe, frequency, ...bytes]);
      }, (frames + 2 + n * 2) * 250),
    );
  }

  return {
    available: async () => ({ available: true, reason: null }),
    async scan() {
      const shout = () => DEVICES.forEach((d) => adverts.emit({ id: d.id, name: d.name, rssi: -48 + Math.round(noise(6)), services: d.services.map((s) => s.uuid) }));
      shout();
      if (!scanTimer) scanTimer = setInterval(shout, 1500);
    },
    async stopScan() {
      if (scanTimer) clearInterval(scanTimer);
      scanTimer = null;
    },
    async connect(id) {
      const d = DEVICES.find((x) => x.id === id);
      if (!d) throw new Error("No such simulated device");
      await new Promise((r) => setTimeout(r, 300));
      connected.add(id);
      ensureTick();
      return d.services;
    },
    async disconnect(id) {
      if (!connected.delete(id)) return;
      for (const k of [...subs]) if (k.startsWith(`${id}|`)) subs.delete(k);
      if (id === "sim:trainer") mode = "free";
      ensureTick();
      drops.emit(id);
    },
    async subscribe(id, service, characteristic, on) {
      if (!connected.has(id)) throw new Error("Not connected");
      const k = key(id, fullUuid(service), fullUuid(characteristic));
      if (on) subs.add(k);
      else subs.delete(k);
    },
    async write(id, service, characteristic, value) {
      if (!connected.has(id)) throw new Error("Not connected");
      const c = fullUuid(characteristic);
      if (id === "sim:trainer" && c === C.control) controlPoint(value);
      if (id === "sim:scale" && c === C.podProfile && value[0] === 0xfe) weighIn();
    },
    async read(id, _service, characteristic) {
      if (!connected.has(id)) throw new Error("Not connected");
      // Fitness Machine Feature: cadence, power; targets: power, simulation.
      if (fullUuid(characteristic) === C.feature) return [0x02, 0x40, 0x00, 0x00, 0x08, 0x20, 0x00, 0x00];
      return [];
    },
    onAdvert: adverts.on,
    onNotify: notes.on,
    onDisconnected: drops.on,
  };
}

export const SIM_IDS = DEVICES.map((d) => d.id);
