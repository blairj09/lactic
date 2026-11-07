import { redirect } from "next/navigation";

// The coach lives in a drawer on every page now; old links open it on Today.
export default function CoachPage() {
  redirect("/#coach");
}
