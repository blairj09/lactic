// Settings → Getting started: the tour again, any time.

import { useNavigate } from "react-router";
import { button } from "@/components/ui";
import { startTour } from "./store";
import { FIRST_STOP } from "./steps";

export function TakeTour() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className={button.secondary}
      onClick={() => {
        navigate("/");
        startTour(FIRST_STOP);
      }}
    >
      Take the tour
    </button>
  );
}

/** The tour as a quiet link, for Today's "Finish setting up". */
export function TakeTourLink() {
  return (
    <button
      type="button"
      className="underline underline-offset-4 hover:text-ink"
      onClick={() => startTour(FIRST_STOP)}
    >
      Take the tour
    </button>
  );
}
