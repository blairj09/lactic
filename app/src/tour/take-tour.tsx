// Settings → Getting started: the tour again, any time.

import { useNavigate } from "react-router";
import { button } from "@/components/ui";
import { startTour } from "./store";
import { FIRST_STOP } from "./steps";

export function TakeTour() {
  const navigate = useNavigate();
  return (
    <div className="sm:col-span-2">
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
    </div>
  );
}
