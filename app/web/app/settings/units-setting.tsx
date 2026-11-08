"use client";

import { Segmented } from "@/components/ui";
import { setUnits, type UnitSystem } from "@/lib/units";
import { useUnits } from "@/lib/use-units";
import { revalidatePath } from "next/cache";

const OPTIONS: { value: UnitSystem; label: string }[] = [
  { value: "metric", label: "Metric" },
  { value: "imperial", label: "Imperial" },
];

export default function UnitsSetting() {
  const units = useUnits();
  return (
    <div className="space-y-2 sm:col-span-2">
      <span className="block text-sm font-medium">Units</span>
      <Segmented
        label="Units"
        options={OPTIONS}
        value={units}
        onChange={(value) => {
          setUnits(value);
          // Pages read the units as they load, so load them again.
          revalidatePath("/");
        }}
      />
      <p className="text-sm text-muted">
        {units === "imperial" ? "Pounds, inches, miles and °F." : "Kilograms, centimeters, kilometers and °C."} Power stays in W/kg either way.
      </p>
    </div>
  );
}
