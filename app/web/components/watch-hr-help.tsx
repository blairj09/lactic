// How to get heart rate from a watch: Lactic reads the standard Bluetooth heart rate signal, which
// many sport watches can send but Apple Watch and Wear OS watches only send through an extra app.

const WATCHES: { name: string; how: string }[] = [
  { name: "Garmin", how: "Open the controls menu (hold the light button) and choose Broadcast Heart Rate. Some older models only broadcast over ANT+, which Lactic can't read." },
  { name: "Polar", how: "Turn on Share HR with other devices from the quick menu or the training view, depending on the model." },
  { name: "Coros", how: "Turn on Heart Rate Broadcast in the watch's settings or toolbox." },
  { name: "Suunto, Wahoo and others", how: "Look for heart rate broadcast in the watch's settings. Newer models send it over Bluetooth." },
  { name: "WHOOP", how: "Turn on Heart Rate Broadcast in the WHOOP app's device settings." },
  { name: "Apple Watch", how: "It doesn't broadcast by itself. A broadcast app from the App Store, such as HeartCast or BlueHeart, makes it show up like a strap." },
  { name: "Pixel Watch, Galaxy Watch and other Wear OS", how: "They don't broadcast by themselves either. Search the Play Store on the watch for a heart rate broadcast app." },
];

export function WatchHeartRateHelp() {
  return (
    <details className="space-y-3 text-sm">
      <summary className="cursor-pointer text-muted">Using a watch instead of a strap?</summary>
      <p className="text-muted">Turn on heart rate broadcast on the watch, keep it close to the computer, and it shows up here like a strap.</p>
      <ul className="space-y-2">
        {WATCHES.map((w) => (
          <li key={w.name}>
            <span className="font-medium">{w.name}:</span> <span className="text-muted">{w.how}</span>
          </li>
        ))}
      </ul>
      <p className="text-faint">Wrist readings lag a few seconds behind a chest strap, so short intervals look smoother than they were.</p>
    </details>
  );
}
