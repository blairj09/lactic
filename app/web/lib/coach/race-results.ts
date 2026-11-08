// Race results read off a screenshot or PDF page by the coach's vision model, written out as text
// lines the engine's results parser reads (engine/race/results.ts). The model only transcribes.

import { openRouterLook } from "./openrouter";
import { visionModel } from "./attachments-server";

const READ = `You transcribe race results for a cycling app. The image is a results sheet or a screenshot of one.
Write one line per rider, in finishing order, in exactly this form and nothing else:
<place> <LAST, First> <total time> <lap 1> <lap 2> ...
- Copy times exactly as shown (m:ss or h:mm:ss). Leave out bib numbers, teams, categories, licenses and gaps.
- If a rider is a lap or more down, add "-1 lap" (or -2...) after their total time.
- If there are no lap times, write only the total. If you can't read a value, leave it out; never guess.`;

export async function readResultsImage(dataUrl: string): Promise<string> {
  const vision = visionModel();
  if (!vision) throw new Error("Reading a screenshot needs the built-in coach. Paste the results as text instead.");
  const text = await openRouterLook(vision.apiKey, vision.model, READ, [{ type: "image_url", image_url: { url: dataUrl } }], { maxTokens: 2000 });
  return text.replace(/^```\w*\n?|```$/g, "").trim();
}
