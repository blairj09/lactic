import { describe, expect, it } from "vitest";
import { attachmentKind, contentWithAttachments, describeGpx, describeRide, parseAttachments, safeFileName, turnsForModel, type Attachment } from "./attachments";

const USER = "11111111-2222-3333-4444-555555555555";

describe("attachmentKind", () => {
  it("knows what the coach can read", () => {
    expect(attachmentKind("shot.png", "image/png")).toBe("image");
    expect(attachmentKind("IMG_1.HEIC", "")).toBe("image");
    expect(attachmentKind("plan.pdf", "application/pdf")).toBe("pdf");
    expect(attachmentKind("Morning_Ride.fit", "application/octet-stream")).toBe("fit");
    expect(attachmentKind("route.gpx", "application/gpx+xml")).toBe("gpx");
    expect(attachmentKind("notes.csv", "text/csv")).toBe("text");
    expect(attachmentKind("workout.zwo", "")).toBe("text");
    expect(attachmentKind("app.exe", "application/x-msdownload")).toBeNull();
  });
});

describe("safeFileName", () => {
  it("keeps names Storage accepts", () => {
    expect(safeFileName("Screen Shot 2026-11-03 at 9.41.12 AM.png")).toBe("Screen-Shot-2026-11-03-at-9.41.12-AM.png");
    expect(safeFileName("Café ride ✓.fit")).toBe("Cafe-ride.fit");
    expect(safeFileName("???")).toBe("file");
  });
});

describe("parseAttachments", () => {
  it("takes only files in your own folder, of kinds the coach reads", () => {
    const parsed = parseAttachments(
      [
        { path: `${USER}/a/shot.png`, name: "shot.png", type: "image/png", size: 1200 },
        { path: `someone-else/a/shot.png`, name: "shot.png", type: "image/png", size: 1200 },
        { path: `${USER}/../x/shot.png`, name: "shot.png", type: "image/png", size: 1200 },
        { path: `${USER}/b/app.exe`, name: "app.exe", type: "", size: 1 },
        "nonsense",
      ],
      USER,
    );
    expect(parsed).toEqual([{ path: `${USER}/a/shot.png`, name: "shot.png", type: "image/png", size: 1200, kind: "image" }]);
    expect(parseAttachments(null, USER)).toEqual([]);
  });
});

describe("turnsForModel", () => {
  const file: Attachment = { path: "p", name: "plan.pdf", type: "application/pdf", size: 1, kind: "pdf", text: "x".repeat(5000) };
  it("sends attachment text after the message, shortened on older messages", () => {
    const messages = [{ role: "user" as const, content: "old", attachments: [file] }, ...Array.from({ length: 6 }, () => ({ role: "assistant" as const, content: "ok" }))];
    messages.push({ role: "user", content: "new", attachments: [file] });
    const turns = turnsForModel(messages);
    expect(turns[0].content.startsWith("old\n\n[Attached: plan.pdf (PDF, its text)]")).toBe(true);
    expect(turns[0].content.length).toBeLessThan(1700);
    expect(turns.at(-1)!.content).toContain("x".repeat(5000));
    expect("attachments" in turns[0]).toBe(false);
  });
  it("says when a file couldn't be read", () => {
    expect(contentWithAttachments("", [{ ...file, text: undefined, note: "Couldn't read this file: broken" }])).toBe("[Attached: plan.pdf (PDF, its text)]\nCouldn't read this file: broken");
  });
});

describe("describeGpx", () => {
  it("gives distance and climbing", () => {
    // About 1.1 km north per 0.01 degree, climbing 50 m then dropping 20 m.
    const points = [
      [45.0, 7.0, 100],
      [45.01, 7.0, 150],
      [45.02, 7.0, 130],
    ];
    const xml = `<gpx><trk><name>Hill loop</name><trkseg>${points.map(([lat, lon, ele]) => `<trkpt lat="${lat}" lon="${lon}"><ele>${ele}</ele></trkpt>`).join("")}</trkseg></trk></gpx>`;
    const text = describeGpx(xml)!;
    expect(text).toContain('Route "Hill loop": 2.2 km, 3 points');
    expect(text).toContain("Climbing: 50 m up, 20 m down; highest 150 m, lowest 100 m");
  });
  it("is null without points", () => {
    expect(describeGpx("<gpx></gpx>")).toBeNull();
  });
});

describe("describeRide", () => {
  it("lists the engine's numbers, with stress from FTP", () => {
    const text = describeRide(
      {
        name: "Lunch ride",
        startedAt: "2026-11-01T12:00:00.000Z",
        distanceMeters: 40_000,
        summary: { durationSeconds: 3600, averagePower: 200, normalizedPower: 220, averageHeartRate: 140, powerCurve: { 5: 600, 60: 400, 300: 300, 1200: 250, 3600: 200 }, powerHistogram: null },
      },
      250,
      null,
    );
    expect(text).toContain("Duration: 1h 00m");
    expect(text).toContain("Distance: 40.0 km");
    expect(text).toContain("Normalized power: 220 W");
    expect(text).toMatch(/Training stress: \d+ \(intensity 0\.88, from power at FTP 250 W\)/);
    expect(text).toContain("Best power: 5 s 600 W, 1 min 400 W, 5 min 300 W, 20 min 250 W, 60 min 200 W");
  });
});
