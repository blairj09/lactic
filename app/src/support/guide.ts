// What the coach knows about fixing common problems, handed over with the app check so its
// advice matches how Lactic actually works.

import type { LogArea } from "./log";

export const GUIDE: Partial<Record<LogArea, string[]>> = {
  bluetooth: [
    "Only one app can control a smart trainer. If Zwift (or another app) is paired to the trainer as 'controllable', Lactic can't set ERG: in Zwift's pairing screen, pair the trainer for Power and Cadence only and leave Controllable unpaired (or pick None). Zwift then just reads.",
    "A trainer or power meter that sleeps stops advertising. Spin the pedals or turn the cranks to wake it; most heart rate straps only wake on skin. Lactic reconnects paired gear by itself when it wakes up.",
    "Many sensors allow one Bluetooth connection at a time. A Karoo, Garmin, phone app or Zwift Companion holding the sensor keeps Lactic from connecting: turn that off or move it out of range.",
    "On macOS, Bluetooth must be on and Lactic allowed in System Settings → Privacy & Security → Bluetooth. If the check says Bluetooth isn't available, that's usually why.",
    "A weak signal (RSSI below about -85 dBm) causes drops: move the computer closer to the trainer or out of the way of metal, USB 3 hubs and Wi-Fi routers.",
    "A power meter that drops often with a low battery report needs a new battery. Until then the trainer can be the power source so ERG stays steady.",
    "If a device was replaced or re-paired elsewhere and won't connect, forget it and pair it again from Settings → Bluetooth.",
    "Simulated gear is a development-only testing switch, not something to suggest. If check_app shows it on, the simulated trainer can show up instead of the real one; it's turned off in Settings of a development build.",
  ],
  intervals: [
    "\"intervals.icu didn't accept the API key\" (401 or 403) means the key is wrong or was regenerated. Get the key from intervals.icu → Settings → Developer settings and paste it in Lactic's Settings → intervals.icu.",
    "A rate limit message means too many requests: wait about 15 minutes and sync again.",
    "Rides recorded by Zwift or a Karoo reach intervals.icu first and come to Lactic on the next sync (every 20 minutes while the app is open, or Sync now).",
    "The first connection imports two years of history in batches in the background; until it finishes, older rides are missing.",
    "Rides that reached intervals.icu from Strava can't be read by Lactic: Strava doesn't let intervals.icu share them. Settings → intervals.icu counts them. Fix: link Garmin, Wahoo, Zwift and others (or the Karoo through the Hammerhead dashboard) to intervals.icu directly for new rides, and import Strava's account archive .zip under Import ride files for past ones.",
    "Rides recorded in Lactic go to intervals.icu only if sending rides is on, and are skipped when Zwift or the Karoo already uploaded the same ride.",
  ],
  health: [
    "Apple Health data comes in from a folder the Health export app writes to. If nothing new arrived, check that the export ran on the phone and that the folder in Settings → Health is the one it writes to.",
  ],
  coach: [
    "If the built-in coach fails, test the model in Settings → Coach. \"The key was turned down\" means the provider's API key is wrong. A model that doesn't use tools can't read training data.",
    "For an external AI app (Claude Desktop and others), the coach mode must be set to external in Settings → Coach (or the built-in coach with Let AI apps connect too ticked) so Lactic's MCP server is on; Claude Desktop needs a restart after Lactic is added.",
  ],
};
