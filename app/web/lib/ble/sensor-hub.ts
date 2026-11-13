/// <reference types="web-bluetooth" />
// Web Bluetooth connection to the trainer, heart rate strap and power meter. Browser only (Chrome/Edge).

import {
  ControlOp,
  GATT,
  controlPoint,
  crankCadence,
  parseControlResponse,
  parseCyclingPower,
  parseHeartRate,
  parseIndoorBikeData,
  type CyclingPowerMeasurement,
} from "./protocol";
import { deviceKind } from "./catalog";
import { connectGatt, findRemembered, forgetDevice, rememberDevice, remembered } from "./devices";
import { PowerMatch } from "./power-match";

export type SensorKind = "trainer" | "heartRate" | "powerMeter";

/** Whose power is shown, recorded and steered by: the trainer's, or the power meter's (pedals). */
export type PowerSource = "trainer" | "powerMeter";

/**
 * idle: not connected (it may still be remembered). connecting: first connect. reconnecting: it
 * dropped and we're getting it back. lost: it dropped and didn't come back.
 */
export type LinkStatus = "idle" | "connecting" | "connected" | "reconnecting" | "lost";

export interface SensorLink {
  status: LinkStatus;
  /** The device's name: the connected one, or the remembered one when idle. */
  name?: string;
  /** Not connected, but listening for it: it connects by itself as soon as it wakes up. */
  waiting?: boolean;
}

export const SENSOR_SERVICE: Record<SensorKind, number> = {
  trainer: GATT.service.fitnessMachine,
  heartRate: GATT.service.heartRate,
  powerMeter: GATT.service.cyclingPower,
};

const RECONNECT_ATTEMPTS = 6;
/** While waiting for a sensor: how often to renew the listen, or to try it blind when Chrome can't listen. */
const WAIT_RETRY_MS = 30_000;

export interface SensorState {
  /** Names of the connected sensors. */
  connected: Partial<Record<SensorKind, string>>;
  links: Record<SensorKind, SensorLink>;
  /** From the power source in use. */
  powerWatts?: number;
  /** Each device's own reading, whichever is in use. */
  trainerWatts?: number;
  meterWatts?: number;
  powerSource: PowerSource;
  /** Trainer watts per power meter watt, while ERG is matched to the power meter. */
  matchRatio?: number;
  cadenceRpm?: number;
  heartRate?: number;
  speedKph?: number;
  /** The ERG target asked for; with power match the trainer is sent this scaled by matchRatio. */
  targetWatts?: number;
  trainerStatus: string;
  /** Most recent R-R intervals in ms, newest last. */
  rrIntervalsMs: number[];
  /**
   * Head unit: another app (Zwift, Rouvy) drives the trainer, so Lactic only reads it. No control
   * request, ERG target or grade ever goes to the trainer while this is on.
   */
  handsOff: boolean;
}

const RR_BUFFER = 600;

/** A remembered sensor that didn't answer: asleep, out of range, or connected to something else. */
export class SensorUnreachable extends Error {
  constructor(
    readonly sensorName: string,
    readonly cause?: unknown,
  ) {
    super(`${sensorName} didn't answer. Wake it up (pedal, or put the strap on) and press Connect again.`);
  }
}

/** The default power source, set on the Ride page or in Settings. */
export const POWER_SOURCE_PREF = "ride.powerSource";

export function isWebBluetoothAvailable(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

export class SensorHub {
  private state: SensorState = {
    connected: {},
    links: { trainer: { status: "idle" }, heartRate: { status: "idle" }, powerMeter: { status: "idle" } },
    trainerStatus: "No trainer",
    rrIntervalsMs: [],
    powerSource: "trainer",
    handsOff: false,
  };
  private listeners = new Set<() => void>();
  private devices: Partial<Record<SensorKind, BluetoothDevice>> = {};
  /** Every sensor seen this page load; these reconnect without the picker even without getDevices. */
  private known: Partial<Record<SensorKind, BluetoothDevice>> = {};
  private control?: BluetoothRemoteGATTCharacteristic;
  private hasControl = false;
  private lastPower?: CyclingPowerMeasurement;
  /** Kinds the user disconnected on purpose, which must not reconnect by themselves. */
  private leaving = new Set<SensorKind>();
  private watched = new WeakSet<BluetoothDevice>();
  private listening = new WeakSet<BluetoothRemoteGATTCharacteristic>();
  /** Kinds mid-connect: a drop then is the attempt failing, which attach handles itself. */
  private attaching = new Set<SensorKind>();
  /** GATT allows one operation at a time per device, so control point writes go through a queue. */
  private writes: Promise<unknown> = Promise.resolve();
  private match = new PowerMatch();
  /** What the trainer was last sent, which differs from targetWatts under power match. */
  private sentWatts?: number;
  /** The simulated grade while ERG is off, so a reconnect can put it back. */
  private grade?: number;
  /** Stops listening for a sensor that hasn't come back yet, per kind. */
  private waits: Partial<Record<SensorKind, () => void>> = {};

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  private update(patch: Partial<SensorState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /**
   * The power meter is the source and connected; otherwise the trainer stands in. With no trainer
   * (it's busy with another app, say) a connected power meter gives the power whatever the pick.
   */
  private get usePowerMeter() {
    const { connected, powerSource } = this.state;
    return connected.powerMeter !== undefined && (powerSource === "powerMeter" || connected.trainer === undefined);
  }

  /**
   * Hands off the trainer (head unit), or back on. On, nothing more is written to the trainer's
   * control point: targets and grades are dropped, even the ones a reconnect would put back.
   */
  setHandsOff(on: boolean) {
    if (on === this.state.handsOff) return;
    this.grade = undefined;
    this.sentWatts = undefined;
    const trainerStatus = !this.state.connected.trainer ? this.state.trainerStatus : on ? "Reading only" : "Trainer connected";
    this.update({ handsOff: on, targetWatts: undefined, matchRatio: undefined, trainerStatus });
  }

  /**
   * Picks whose power counts. With the power meter, ERG is power matched: the trainer is sent the
   * target scaled so the power meter reads it.
   */
  setPowerSource(source: PowerSource) {
    if (source === this.state.powerSource) return;
    const reading = source === "powerMeter" && this.state.connected.powerMeter ? this.state.meterWatts : this.state.trainerWatts;
    this.update({ powerSource: source, powerWatts: reading ?? this.state.powerWatts });
    this.resendTarget();
  }

  /** Sends the ERG target again when what the trainer should get has changed. */
  private resendTarget() {
    const target = this.state.targetWatts;
    if (target === undefined || !this.control || this.trainerTarget(target) === this.sentWatts) return;
    this.setTargetPower(target).catch(() => undefined);
  }

  private trainerTarget(watts: number) {
    return this.usePowerMeter ? this.match.target(watts) : watts;
  }

  /** The user's name for the sensor from Settings, else what it advertises. */
  private nameOf(kind: SensorKind, device: BluetoothDevice) {
    const saved = remembered(kind);
    return saved?.id === device.id ? saved.name : (device.name ?? "Unknown sensor");
  }

  private setLink(kind: SensorKind, link: SensorLink) {
    const connected = { ...this.state.connected };
    if (link.status === "connected") connected[kind] = link.name ?? "Unknown sensor";
    else delete connected[kind];
    this.update({ links: { ...this.state.links, [kind]: link }, connected });
  }

  /** Shows remembered sensors by name before they connect. Call once in the browser. */
  loadRemembered() {
    for (const kind of Object.keys(SENSOR_SERVICE) as SensorKind[]) {
      const saved = remembered(kind);
      if (saved && this.state.links[kind].status === "idle") this.setLink(kind, { status: "idle", name: saved.name });
    }
  }

  /**
   * Connects every remembered sensor Chrome can hand back without the picker. Sensors that are
   * asleep stay idle; pressing Connect tries them again.
   */
  async restore(): Promise<void> {
    this.loadRemembered();
    await Promise.all(
      (Object.keys(SENSOR_SERVICE) as SensorKind[]).map(async (kind) => {
        if (this.state.links[kind].status !== "idle") return;
        const device = await findRemembered(kind);
        if (!device) return;
        try {
          await this.attach(kind, device, { attempts: 1 });
        } catch {
          this.setLink(kind, { status: "idle", name: this.nameOf(kind, device) });
          this.waitFor(kind, device);
        }
      }),
    );
  }

  /**
   * Connects the remembered sensor, or opens Chrome's picker for a new one. Call it from a click,
   * as Web Bluetooth requires for the picker.
   */
  async connect(kind: SensorKind, { choose = false } = {}): Promise<void> {
    this.leaving.delete(kind);
    this.stopWaiting(kind);
    const known = choose ? undefined : (this.known[kind] ?? (await findRemembered(kind)));
    if (known) {
      try {
        return await this.attach(kind, known, { attempts: 2 });
      } catch (e) {
        if (this.leaving.has(kind)) return;
        this.setLink(kind, { status: "idle", name: this.nameOf(kind, known) });
        this.waitFor(kind, known);
        // The picker can't open now: the click that asked for it is too long ago.
        throw new SensorUnreachable(this.nameOf(kind, known), e);
      }
    }
    const device = await navigator.bluetooth.requestDevice(deviceKind(kind).request);
    rememberDevice(kind, device);
    await this.attach(kind, device);
  }

  private async attach(kind: SensorKind, device: BluetoothDevice, { attempts = 3, reconnecting = false } = {}) {
    if (this.devices[kind] && this.devices[kind] !== device) this.devices[kind]?.gatt?.disconnect();
    this.devices[kind] = device;
    this.known[kind] = device;
    this.setLink(kind, { status: reconnecting ? "reconnecting" : "connecting", name: this.nameOf(kind, device) });
    this.attaching.add(kind);
    try {
      const server = await connectGatt(device, { attempts, cancelled: () => this.leaving.has(kind) });
      if (this.leaving.has(kind)) throw new DOMException("Connection cancelled", "AbortError");
      if (!this.watched.has(device)) {
        this.watched.add(device);
        device.addEventListener("gattserverdisconnected", () => {
          if (this.devices[kind] === device && !this.attaching.has(kind)) this.handleDisconnect(kind, device);
        });
      }
      const primary = await server.getPrimaryService(SENSOR_SERVICE[kind]);
      if (kind === "trainer") await this.setUpTrainer(primary);
      if (kind === "heartRate") await this.notify(primary, GATT.characteristic.heartRateMeasurement, (v) => this.onHeartRate(v));
      if (kind === "powerMeter") await this.notify(primary, GATT.characteristic.cyclingPowerMeasurement, (v) => this.onPower(v));
    } catch (e) {
      device.gatt?.disconnect();
      throw e;
    } finally {
      this.attaching.delete(kind);
    }
    this.setLink(kind, { status: "connected", name: this.nameOf(kind, device) });
    // After a drop mid-workout, put the trainer back on the target it had.
    if (kind === "trainer" && reconnecting && this.state.targetWatts !== undefined) {
      this.setTargetPower(this.state.targetWatts).catch(() => undefined);
    } else if (kind === "trainer" && reconnecting && this.grade !== undefined) {
      this.setSimulationGrade(this.grade).catch(() => undefined);
    }
    // The power meter is back: match to it again.
    if (kind === "powerMeter") this.resendTarget();
  }

  disconnect(kind: SensorKind) {
    this.leaving.add(kind);
    this.stopWaiting(kind);
    const device = this.devices[kind];
    device?.gatt?.disconnect();
    if (device) this.handleDisconnect(kind, device);
  }

  /** Disconnects and forgets the sensor, so the next Connect opens the picker. */
  async forget(kind: SensorKind) {
    const device = this.devices[kind];
    this.disconnect(kind);
    delete this.known[kind];
    await forgetDevice(kind, device);
    this.setLink(kind, { status: "idle" });
  }

  /** ERG mode. Requests control of the trainer first if we don't have it yet. Does nothing hands off. */
  setTargetPower(watts: number): Promise<void> {
    if (this.state.handsOff) return Promise.resolve();
    this.grade = undefined;
    this.update({ targetWatts: watts, matchRatio: this.usePowerMeter ? this.match.ratio : undefined });
    return this.enqueue(async (control) => {
      // Worked out when the write runs, so a queued target picks up the latest match.
      const send = this.trainerTarget(watts);
      await this.ensureControl(control);
      // Set before writing: the trainer's answer can arrive before the write resolves.
      this.sentWatts = send;
      await control.writeValueWithResponse(controlPoint.setTargetPower(send));
    });
  }

  /** The trainer rides like a road at this grade. Does nothing hands off. */
  setSimulationGrade(gradePercent: number): Promise<void> {
    if (this.state.handsOff) return Promise.resolve();
    this.update({ targetWatts: undefined, matchRatio: undefined });
    this.sentWatts = undefined;
    this.grade = gradePercent;
    return this.enqueue(async (control) => {
      await this.ensureControl(control);
      await control.writeValueWithResponse(controlPoint.setSimulation(gradePercent));
    });
  }

  private async ensureControl(control: BluetoothRemoteGATTCharacteristic) {
    if (this.hasControl) return;
    await control.writeValueWithResponse(controlPoint.requestControl());
    // Assume success; a refusal arrives as an indication and flips this back.
    this.hasControl = true;
  }

  private enqueue(work: (control: BluetoothRemoteGATTCharacteristic) => Promise<void>): Promise<void> {
    const run = this.writes.then(async () => {
      // Checked again when the write runs: hands off may have come on while it was queued.
      if (this.state.handsOff) return;
      if (!this.control) throw new Error("No trainer connected");
      await work(this.control);
    });
    // Keep the queue alive after a failure so the next command still runs.
    this.writes = run.catch(() => undefined);
    return run;
  }

  private async setUpTrainer(service: BluetoothRemoteGATTService) {
    await this.notify(service, GATT.characteristic.indoorBikeData, (v) => {
      const bike = parseIndoorBikeData(v);
      if (!bike) return;
      const patch: Partial<SensorState> = { speedKph: bike.speedKph ?? this.state.speedKph, trainerWatts: bike.powerWatts ?? this.state.trainerWatts };
      const rematch = bike.powerWatts !== undefined && this.match.addTrainer(bike.powerWatts, Date.now());
      if (!this.usePowerMeter) {
        patch.powerWatts = bike.powerWatts ?? this.state.powerWatts;
        patch.cadenceRpm = bike.cadenceRpm ?? this.state.cadenceRpm;
      }
      this.update(patch);
      if (rematch && this.usePowerMeter) this.resendTarget();
    });
    // Responses arrive as indications, which must be on before the first write.
    this.control = await this.notify(service, GATT.characteristic.fitnessMachineControlPoint, (v) => {
      const response = parseControlResponse(v);
      if (!response) return;
      if (response.request === ControlOp.requestControl) {
        this.hasControl = response.succeeded;
        this.update({ trainerStatus: response.succeeded ? "In control" : "Trainer refused control. Is another app controlling it?" });
      } else if (response.request === ControlOp.setTargetPower) {
        const target = this.state.targetWatts ?? 0;
        const matched = this.sentWatts !== undefined && this.sentWatts !== target ? ` (trainer sent ${this.sentWatts} W to match the power meter)` : "";
        this.update({ trainerStatus: response.succeeded ? `ERG ${target} W${matched}` : "Trainer rejected the target" });
      }
    });
    this.hasControl = false;
    this.update({ trainerStatus: this.state.handsOff ? "Reading only" : "Trainer connected" });
  }

  private async notify(service: BluetoothRemoteGATTService, uuid: number, handler: (value: DataView) => void) {
    const characteristic = await service.getCharacteristic(uuid);
    // Chrome can hand back the same object after a reconnect; one listener is enough.
    if (!this.listening.has(characteristic)) {
      this.listening.add(characteristic);
      characteristic.addEventListener("characteristicvaluechanged", () => {
        if (characteristic.value) handler(characteristic.value);
      });
    }
    await characteristic.startNotifications();
    return characteristic;
  }

  private onHeartRate(value: DataView) {
    const hr = parseHeartRate(value);
    if (!hr) return;
    const rr = hr.rrIntervalsMs.length ? [...this.state.rrIntervalsMs, ...hr.rrIntervalsMs].slice(-RR_BUFFER) : this.state.rrIntervalsMs;
    this.update({ heartRate: hr.bpm, rrIntervalsMs: rr });
  }

  private onPower(value: DataView) {
    const measurement = parseCyclingPower(value);
    if (!measurement) return;
    const cadence = this.lastPower ? crankCadence(this.lastPower, measurement) : null;
    this.lastPower = measurement;
    const rematch = this.match.addMeter(measurement.watts, Date.now());
    if (!this.usePowerMeter) return this.update({ meterWatts: measurement.watts });
    this.update({ meterWatts: measurement.watts, powerWatts: measurement.watts, cadenceRpm: cadence ?? this.state.cadenceRpm });
    if (rematch) this.resendTarget();
  }

  private handleDisconnect(kind: SensorKind, device: BluetoothDevice) {
    if (kind === "trainer") {
      this.control = undefined;
      this.hasControl = false;
      this.sentWatts = undefined;
      // Its last reading isn't live any more; with the power meter in use, its numbers stay.
      this.update({ trainerWatts: undefined, ...(this.state.connected.powerMeter ? {} : { powerWatts: undefined, cadenceRpm: undefined }) });
    }
    if (kind === "powerMeter") {
      this.lastPower = undefined;
      this.update({ meterWatts: undefined });
      // Without its power meter the trainer stands in, on the plain target.
      if (this.state.powerSource === "powerMeter") queueMicrotask(() => this.resendTarget());
    }
    if (this.leaving.has(kind)) {
      delete this.devices[kind];
      this.setLink(kind, { status: "idle", name: this.nameOf(kind, device) });
      if (kind === "trainer") this.update({ trainerStatus: "No trainer" });
      return;
    }
    if (kind === "trainer") this.update({ trainerStatus: "Trainer dropped. Reconnecting" });
    this.attach(kind, device, { attempts: RECONNECT_ATTEMPTS, reconnecting: true }).catch(() => {
      if (this.devices[kind] !== device || this.leaving.has(kind)) return;
      this.setLink(kind, { status: "lost", name: this.nameOf(kind, device) });
      if (kind === "trainer") this.update({ trainerStatus: "Trainer lost" });
      this.waitFor(kind, device);
    });
  }

  /**
   * Listens for a remembered sensor that didn't answer and connects it the moment it advertises
   * (the strap goes on, the trainer or pedals wake up), with a slow retry as a backstop. Without
   * watchAdvertisements (Chrome's flags off) only the slow retry runs. Stops once it connects,
   * on Disconnect or Connect, or on stopWaiting.
   */
  private waitFor(kind: SensorKind, device: BluetoothDevice) {
    this.stopWaiting(kind);
    if (this.leaving.has(kind)) return;
    let stopped = false;
    let trying = false;
    let watch: AbortController | undefined;
    let canWatch = typeof device.watchAdvertisements === "function";
    const status = this.state.links[kind].status === "lost" ? "lost" : "idle";
    const showWaiting = () => this.setLink(kind, { status, name: this.nameOf(kind, device), waiting: true });

    const listen = () => {
      watch?.abort();
      if (stopped || !canWatch) return;
      watch = new AbortController();
      device.watchAdvertisements({ signal: watch.signal }).catch((e) => {
        // Aborting our own watch rejects too; anything else means Chrome won't listen for it.
        if (!(e instanceof DOMException && e.name === "AbortError")) canWatch = false;
      });
    };
    const attempt = async () => {
      if (stopped || trying || this.leaving.has(kind) || this.state.links[kind].status === "connected") return;
      trying = true;
      try {
        await this.attach(kind, device, { attempts: 1, reconnecting: status === "lost" });
        stop();
      } catch {
        if (stopped) return;
        showWaiting();
        // A connect attempt ends Chrome's watch on the device, so listen again.
        listen();
      } finally {
        trying = false;
      }
    };
    const onAdvertisement = () => void attempt();
    // Listening is cheap and quiet, so renew it; only without it fall back to trying blind.
    const timer = setInterval(() => (canWatch ? listen() : void attempt()), WAIT_RETRY_MS);
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      watch?.abort();
      device.removeEventListener?.("advertisementreceived", onAdvertisement);
      if (this.waits[kind] === stop) delete this.waits[kind];
      const link = this.state.links[kind];
      if (link.waiting) this.setLink(kind, { ...link, waiting: false });
    };
    this.waits[kind] = stop;
    device.addEventListener("advertisementreceived", onAdvertisement);
    showWaiting();
    listen();
  }

  private stopWaiting(kind: SensorKind) {
    this.waits[kind]?.();
  }

  /** Stops listening for every sensor that hasn't come back, e.g. on leaving the Ride page. */
  stopWaitingAll() {
    for (const kind of Object.keys(SENSOR_SERVICE) as SensorKind[]) this.stopWaiting(kind);
  }
}
