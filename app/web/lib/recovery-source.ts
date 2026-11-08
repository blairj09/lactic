// Where the rider's sleep and recovery come from: the source picked in Sleep and recovery setup, and
// whether Apple Health files have come in. The desktop shell provides the loader; elsewhere nothing is known.

export type RecoverySource = "apple" | "intervals";

export interface RecoverySetup {
  /** The source picked in setup, if any. */
  picked: RecoverySource | null;
  /** Apple Health files have been imported before. */
  appleReceiving: boolean;
}

const NONE: RecoverySetup = { picked: null, appleReceiving: false };
let loader: () => Promise<RecoverySetup> = async () => NONE;

export function provideRecoverySetup(load: () => Promise<RecoverySetup>) {
  loader = load;
}

export async function loadRecoverySetup(): Promise<RecoverySetup> {
  try {
    return await loader();
  } catch {
    return NONE;
  }
}

export interface RecoverySourceInfo {
  name: "Apple Health" | "intervals.icu";
  /** Set up to send nights, so last night is worth waiting for. */
  connected: boolean;
}

/** The name to show for the rider's recovery source, and whether it's set up to send nights. */
export function recoverySourceInfo(setup: RecoverySetup, intervalsConnected: boolean): RecoverySourceInfo | null {
  const picked = setup.picked ?? (setup.appleReceiving ? "apple" : null);
  if (picked === "apple") return { name: "Apple Health", connected: setup.appleReceiving };
  if (picked === "intervals") return { name: "intervals.icu", connected: intervalsConnected };
  return null;
}
