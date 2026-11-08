"use client";

import { Segmented } from "@/components/ui";
import { readTheme, setTheme, type ThemeChoice } from "@/lib/theme";
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
