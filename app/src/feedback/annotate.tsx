// Mark up a screenshot before sending: drag to draw a red box or circle around the problem.
// Marks stay editable (undo, clear) until Done (or Attach), which flattens them into the JPEG that's sent.

import { useEffect, useRef, useState } from "react";
import { button, Segmented } from "@/components/ui";

export type Tool = "box" | "circle";
export interface Mark {
  tool: Tool;
  x: number;
  y: number;
  w: number;
  h: number;
}

const RED = "#e5372b";

/** Draws marks onto a canvas sized to the image, with a line width that reads at any size. */
export function drawMarks(ctx: CanvasRenderingContext2D, marks: Mark[], width: number) {
  ctx.lineWidth = Math.max(3, Math.round(width / 300));
  ctx.strokeStyle = RED;
  ctx.lineJoin = "round";
  for (const m of marks) {
    const x = Math.min(m.x, m.x + m.w);
    const y = Math.min(m.y, m.y + m.h);
    const w = Math.abs(m.w);
    const h = Math.abs(m.h);
    ctx.beginPath();
    if (m.tool === "box") ctx.rect(x, y, w, h);
    else ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

export function Annotate({ src, initial, onDone, onCancel, doneLabel = "Done" }: { src: string; initial: Mark[]; onDone: (marks: Mark[]) => void; onCancel: () => void; doneLabel?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<Tool>("box");
  const [marks, setMarks] = useState<Mark[]>(initial);
  const [drawing, setDrawing] = useState<Mark | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setImage(img);
    img.src = src;
  }, [src]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !image) return;
    c.width = image.naturalWidth;
    c.height = image.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    drawMarks(ctx, drawing ? [...marks, drawing] : marks, c.width);
  }, [image, marks, drawing]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onCancel();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") setMarks((m) => m.slice(0, -1));
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [onCancel]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="Mark up screenshot">
      <div className="flex w-full max-w-5xl flex-wrap items-center gap-2 rounded-lg bg-ground p-2">
        <Segmented
          label="Shape"
          value={tool}
          onChange={setTool}
          options={[
            { value: "box", label: "Box" },
            { value: "circle", label: "Circle" },
          ]}
        />
        <button type="button" className={button.small} disabled={!marks.length} onClick={() => setMarks((m) => m.slice(0, -1))}>
          Undo
        </button>
        <button type="button" className={button.small} disabled={!marks.length} onClick={() => setMarks([])}>
          Clear
        </button>
        <span className="hidden text-sm text-muted sm:inline">Drag over the problem.</span>
        <span className="ml-auto flex gap-2">
          <button type="button" className={button.small} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={button.smallPrimary} onClick={() => onDone(marks)}>
            {doneLabel}
          </button>
        </span>
      </div>
      <canvas
        ref={canvas}
        className="max-h-[80vh] max-w-full cursor-crosshair touch-none rounded-md bg-white"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = point(e);
          setDrawing({ tool, x: p.x, y: p.y, w: 0, h: 0 });
        }}
        onPointerMove={(e) => {
          if (!drawing) return;
          const p = point(e);
          setDrawing({ ...drawing, w: p.x - drawing.x, h: p.y - drawing.y });
        }}
        onPointerUp={() => {
          if (drawing && Math.abs(drawing.w) > 4 && Math.abs(drawing.h) > 4) setMarks((m) => [...m, drawing]);
          setDrawing(null);
        }}
      />
    </div>
  );
}
