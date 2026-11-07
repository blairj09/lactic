// Small Settings panels of Lactic's own.

import { useEffect, useState } from "react";
import { button, Result } from "@/components/ui";
import { scanning, simEnabled, SIM_SETTING } from "~/bluetooth/web-bluetooth";
import { appInfo, fileManagerName, invoke, isDesktop, openExternal, type AppInfo } from "~/platform/native";
import { setSetting } from "~/settings/store";

export function SimulatorSwitch() {
  const [on, setOn] = useState(simEnabled());
  return (
    <label className="flex items-start gap-3 text-sm sm:col-span-2">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={on}
        onChange={async (e) => {
          setOn(e.target.checked);
          await setSetting(SIM_SETTING, e.target.checked);
          await scanning.release();
          await scanning.hold();
          await scanning.release();
        }}
      />
      <span>
        <span className="block font-medium">Show simulated gear</span>
        <span className="text-muted">They appear alongside real devices when you pair. The simulated rider pedals at 90 rpm and follows ERG targets.</span>
      </span>
    </label>
  );
}

export function AboutPanel() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    void appInfo().then(setInfo);
    if (isDesktop) void invoke<string>("db_path").then(setPath);
  }, []);

  async function backup() {
    setResult(null);
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const to = await save({ defaultPath: `Lactic backup ${new Date().toISOString().slice(0, 10)}.db`, filters: [{ name: "Lactic database", extensions: ["db"] }] });
      if (!to) return;
      await invoke("db_backup", { to });
      setResult({ ok: true, message: `Saved to ${to}.` });
    } catch (e) {
      setResult({ ok: false, message: String(e) });
    }
  }

  async function reveal() {
    if (!path) return;
    const opener = await import("@tauri-apps/plugin-opener");
    await opener.revealItemInDir(path);
  }

  return (
    <div className="space-y-4 text-sm sm:col-span-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
        <dt className="text-muted">Version</dt>
        <dd className="num">{info?.version ?? "…"}</dd>
        <dt className="text-muted">Database</dt>
        <dd className="truncate">{path ?? (isDesktop ? "…" : "In this browser (development)")}</dd>
      </dl>
      {isDesktop && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button.small} onClick={() => void backup()}>
            Back up…
          </button>
          <button type="button" className={button.small} onClick={() => void reveal()}>
            Show in {fileManagerName() === "your file manager" ? "folder" : fileManagerName()}
          </button>
        </div>
      )}
      {result && <Result ok={result.ok}>{result.message}</Result>}
      <p className="text-muted">
        Lactic is free and open source.{" "}
        <button type="button" className="text-ink underline underline-offset-4" onClick={() => void openExternal("https://lactic.fit")}>
          lactic.fit
        </button>
      </p>
    </div>
  );
}
