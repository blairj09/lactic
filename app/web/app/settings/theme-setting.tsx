"use client";

import { Segmented } from "@/components/ui";
import { readContrast, readTheme, setContrast, setTheme, type ContrastChoice, type ThemeChoice } from "@/lib/theme";
import { useEffect, useState } from "react";

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function ThemeSetting() {
  // Read after mount: the server can't see this device's choice.
  const [choice, setChoice] = useState<ThemeChoice | null>(null);
  useEffect(() => setChoice(readTheme()), []);
  return (
    <div className="space-y-2 sm:col-span-2">
      <span className="block text-sm font-medium">Theme</span>
      <Segmented
        label="Theme"
        options={OPTIONS}
        value={choice}
        onChange={(value) => {
          setChoice(value);
          setTheme(value);
        }}
      />
      <p className="text-sm text-muted">System follows your computer&apos;s light or dark mode.</p>
    </div>
  );
}

const CONTRAST_OPTIONS: { value: ContrastChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "standard", label: "Standard" },
  { value: "high", label: "High" },
];

export function ContrastSetting() {
  const [choice, setChoice] = useState<ContrastChoice | null>(null);
  useEffect(() => setChoice(readContrast()), []);
  return (
    <div className="space-y-2 sm:col-span-2">
      <span className="block text-sm font-medium">Contrast</span>
      <Segmented
        label="Contrast"
        options={CONTRAST_OPTIONS}
        value={choice}
        onChange={(value) => {
          setChoice(value);
          setContrast(value);
        }}
      />
      <p className="text-sm text-muted">System follows your computer&apos;s Increase contrast setting.</p>
    </div>
  );
}
