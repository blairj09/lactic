"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** A sheet over the page, closed with ×, Escape or a click outside; closing goes back to the page underneath. */
export default function Sheet({ children, width = "wide" }: { children: React.ReactNode; width?: "medium" | "wide" }) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === "Escape" && router.back();
    window.addEventListener("keydown", close);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      window.removeEventListener("keydown", close);
      document.body.style.overflow = overflow;
    };
  }, [router]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 px-2 py-4 sm:px-6 sm:py-10"
      onClick={(e) => e.target === e.currentTarget && router.back()}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={`relative w-full ${width === "wide" ? "max-w-6xl" : "max-w-5xl"} space-y-6 sm:space-y-8 rounded-xl border border-line bg-ground p-4 shadow-2xl outline-none sm:p-6`}
      >
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-md text-xl text-muted hover:bg-raised hover:text-ink"
        >
          ×
        </button>
        {children}
      </div>
    </div>
  );
}
