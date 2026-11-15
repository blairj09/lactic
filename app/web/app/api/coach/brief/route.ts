// Today's morning brief: the stored one, or written now and streamed back as events (see ../stream.ts).

import { brief, coachModel } from "@/lib/coach/conversation";
import { createClient } from "@/lib/supabase/server";
import { eventStream } from "../stream";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  if (!coachModel()) return Response.json({ error: "Finish setting up the coach first: pick a model and add its API key in Settings → Coach." }, { status: 503 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  return eventStream((hooks) => brief(supabase, hooks));
}
