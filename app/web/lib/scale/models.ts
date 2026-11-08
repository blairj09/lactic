// Which smart scales Lactic reads, and how to tell them apart from what they advertise. Pure: no
// browser or Node APIs.
//
// Four ways in, covering most Bluetooth scales sold today:
//   bodyPod   Hume Body Pod (Lefu), connected, with segment impedance from the handle.
//   standard  The Bluetooth SIG Weight Scale and Body Composition services (Omron, A&D, Beurer,
//             Sanitas, Medisana, Silvercrest and many others), connected.
//   xiaomi    Xiaomi Mi Smart Scale and Mi Body Composition Scale 2: weight broadcast in the
//             advertisement, so nothing to connect or pair.
//   qn        QN/Yolanda scales (Renpho, Etekcity ESF-24 and others sold as "QN-Scale"), connected.
//   etekcity  Etekcity ESF-551 smart fitness scale, connected.

import { BODY_POD } from "./bodypod";

export type ScaleFamily = "bodyPod" | "standard" | "xiaomi" | "qn" | "etekcity";

export interface ScaleFamilyInfo {
  label: string;
  /** Brands and models, for the list of scales that work. */
  examples: string;
  /** How a weigh-in reaches Lactic: a connection, or the scale's advertisement. */
  transport: "gatt" | "broadcast";
  /** Stored as `body_measurements.source`. */
  source: string;
  /** What to do before stepping on. */
  hint: string;
}

export const SCALE_FAMILIES: Record<ScaleFamily, ScaleFamilyInfo> = {
  bodyPod: {
    label: "Hume Body Pod",
    examples: "Hume Body Pod and Body Pod 2",
    transport: "gatt",
    source: "body_pod",
    hint: "Barefoot, holding the handle. Close the Hume app first.",
  },
  standard: {
    label: "Bluetooth weight scale",
    examples: "Scales with the standard Bluetooth weight profile: Omron, A&D, Beurer, Sanitas, Medisana, Silvercrest and others",
    transport: "gatt",
    source: "ble_scale",
    hint: "Close the scale's own phone app first so it doesn't take the connection.",
  },
  xiaomi: {
    label: "Xiaomi Mi scale",
    examples: "Xiaomi Mi Smart Scale 2 and Mi Body Composition Scale 2",
    transport: "broadcast",
    source: "mi_scale",
    hint: "Step on barefoot. Nothing to connect: Lactic reads the scale's broadcast.",
  },
  qn: {
    label: "QN scale",
    examples: "Renpho, Etekcity ESF-24 and other scales that show up as QN-Scale",
    transport: "gatt",
    source: "qn_scale",
    hint: "Close the scale's own phone app first so it doesn't take the connection.",
  },
  etekcity: {
    label: "Etekcity scale",
    examples: "Etekcity ESF-551 smart fitness scale",
    transport: "gatt",
    source: "etekcity",
    hint: "Close the VeSync app first so it doesn't take the connection.",
  },
};

export const SCALE_FAMILY_ORDER: ScaleFamily[] = ["bodyPod", "xiaomi", "qn", "etekcity", "standard"];

/** 16-bit Bluetooth UUIDs the scales use. */
export const SCALE_UUID = {
  weightScale: 0x181d,
  bodyComposition: 0x181b,
  weightMeasurement: 0x2a9d,
  bodyCompositionMeasurement: 0x2a9c,
  currentTimeService: 0x1805,
  currentTime: 0x2a2b,
  vendorFff0: 0xfff0,
  vendorFfe0: 0xffe0,
} as const;

/** Etekcity's Bluetooth company id, in the ESF-551's manufacturer data. */
export const ETEKCITY_COMPANY_ID = 1744;

/** What a scale advertises, as Lactic's Bluetooth layer reports it. */
export interface ScaleAdvert {
  name?: string | null;
  /** Service UUIDs, 16-bit hex ("181d") or full. */
  services?: string[];
  /** Service data by UUID. */
  serviceData?: Record<string, number[]>;
  /** Manufacturer data by company id. */
  manufacturerData?: Record<string, number[]>;
}

const short = (uuid: string) => {
  const s = uuid.toLowerCase();
  const m = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/.exec(s);
  return m ? m[1] : s;
};
const hex = (n: number) => n.toString(16).padStart(4, "0");

/** Service data for a 16-bit UUID, whichever way the key is written. */
export function serviceDataFor(ad: ScaleAdvert, uuid: number): number[] | undefined {
  for (const [key, value] of Object.entries(ad.serviceData ?? {})) if (short(key) === hex(uuid)) return value;
  return undefined;
}

const NAMES: [ScaleFamily, RegExp][] = [
  ["bodyPod", /^(Body Pod|Hume)/i],
  ["xiaomi", /^(MIBCS|MIBFS|MI_SCALE|MI SCALE2)$/i],
  ["qn", /^QN-Scale/i],
  ["etekcity", /^(Etekcity.*Fitness.*Scale|ESF-?551)/i],
];

/** Names to offer in the device picker, so scales that don't advertise a service still show up. */
export const SCALE_NAME_PREFIXES = ["Body Pod", "Hume", "MIBCS", "MIBFS", "MI_SCALE", "MI SCALE2", "QN-Scale", "Etekcity"];

/** Which kind of scale an advertisement (or just a name) is from, or null if it isn't a scale Lactic knows. */
export function identifyScale(ad: ScaleAdvert): ScaleFamily | null {
  const name = ad.name ?? "";
  for (const [family, pattern] of NAMES) if (pattern.test(name)) return family;
  // Xiaomi puts the weight in service data under the weight and body composition UUIDs.
  if ((serviceDataFor(ad, SCALE_UUID.bodyComposition)?.length ?? 0) >= 13) return "xiaomi";
  if ((serviceDataFor(ad, SCALE_UUID.weightScale)?.length ?? 0) >= 10) return "xiaomi";
  if (ad.manufacturerData && Object.keys(ad.manufacturerData).some((k) => Number(k) === ETEKCITY_COMPANY_ID)) return "etekcity";
  const services = new Set((ad.services ?? []).map(short));
  if (services.has(hex(SCALE_UUID.weightScale)) || services.has(hex(SCALE_UUID.bodyComposition))) return "standard";
  if (services.has(hex(SCALE_UUID.vendorFfe0)) && /scale/i.test(name)) return "qn";
  return null;
}

/** What the device list filters on: every scale Lactic can read. */
export const SCALE_REQUEST: RequestDeviceOptions = {
  filters: [
    { services: [BODY_POD.service] },
    { services: [SCALE_UUID.weightScale] },
    { services: [SCALE_UUID.bodyComposition] },
    ...SCALE_NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
  ],
  optionalServices: [BODY_POD.service, SCALE_UUID.vendorFfe0, SCALE_UUID.weightScale, SCALE_UUID.bodyComposition, SCALE_UUID.currentTimeService],
};

/** Plausible body weights; anything else is the scale settling, empty, or a misread. */
export const plausibleKg = (kg: number) => kg >= 10 && kg <= 300;

export const LB_TO_KG = 0.45359237;
