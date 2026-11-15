// Lactic's own landscape for a course ride: drawn from the land's real heights, not photographed.
// Each map tile is painted from its elevations: color by height within the course's range, light
// from the northwest so slopes read, and contour lines. Pure pixel math, so it tests in Node.

export type LandscapeLook = "night" | "day";

export const LANDSCAPE_LOOKS: LandscapeLook[] = ["night", "day"];

type RGB = [number, number, number];

interface Palette {
  /** Land colors from the course's lowest ground to its highest. */
  ramp: RGB[];
  contour: RGB;
  /** How strongly a contour and a bold (every fifth) contour show, 0-1. */
  line: number;
  bold: number;
  /** Shade at its darkest and brightest, as multipliers. */
  dark: number;
  bright: number;
  sky: { sky: string; horizon: string; fog: string };
  /** The road outside the picked section, and the casing under the section. */
  road: string;
  casing: string;
  /** What's on the land: water, forest, and the other roads you pass. */
  water: string;
  forest: string;
  forestOpacity: number;
  roads: string;
}

export const PALETTES: Record<LandscapeLook, Palette> = {
  night: {
    ramp: [
      [10, 16, 38],
      [20, 30, 72],
      [34, 50, 112],
      [58, 78, 156],
      [104, 124, 198],
    ],
    contour: [150, 176, 255],
    line: 0.22,
    bold: 0.5,
    dark: 0.5,
    bright: 1.45,
    sky: { sky: "#070b1c", horizon: "#2b55d6", fog: "#141d44" },
    road: "#9fb4ff",
    casing: "#0a1026",
    water: "#46d7ff",
    forest: "#11a08c",
    forestOpacity: 0.2,
    roads: "#c9d4ff",
  },
  day: {
    ramp: [
      [226, 230, 214],
      [208, 219, 196],
      [224, 216, 190],
      [236, 226, 208],
      [250, 248, 244],
    ],
    contour: [120, 104, 82],
    line: 0.2,
    bold: 0.45,
    dark: 0.68,
    bright: 1.12,
    sky: { sky: "#a9c4f2", horizon: "#f1efe6", fog: "#f1efe6" },
    road: "#5b6472",
    casing: "#ffffff",
    water: "#5a9fe0",
    forest: "#5f8f62",
    forestOpacity: 0.24,
    roads: "#8a8172",
  },
};

/** Meters between contour lines for a tile whose pixels are `metersPerPixel` across: closer lines when you're close. */
export function contourInterval(metersPerPixel: number): number {
  if (metersPerPixel < 12) return 10;
  if (metersPerPixel < 25) return 20;
  if (metersPerPixel < 60) return 50;
  if (metersPerPixel < 150) return 100;
  return 250;
}

/** Meters a pixel covers in a 256-pixel web map tile at a zoom and latitude. */
export function metersPerPixel(zoom: number, lat: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** The latitude of the middle of a tile row. */
export function tileLat(zoom: number, y: number): number {
  const n = Math.PI - (2 * Math.PI * (y + 0.5)) / 2 ** zoom;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

/** Heights from a Terrarium-encoded tile's RGBA pixels, meters. */
export function terrariumHeights(rgba: ArrayLike<number>): Float32Array {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4] * 256 + rgba[i * 4 + 1] + rgba[i * 4 + 2] / 256 - 32768;
  return out;
}

/** Heights at twice the detail, blended between samples, so lines and light come out smooth up close. */
export function doubleHeights(heights: ArrayLike<number>, size: number): Float32Array {
  const n = size * 2;
  const out = new Float32Array(n * n);
  const at = (x: number, y: number) => heights[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))];
  for (let y = 0; y < n; y++) {
    // Each new pixel sits a quarter of an old pixel either side of an old pixel's middle.
    const fy = (y + 0.5) / 2 - 0.5;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < n; x++) {
      const fx = (x + 0.5) / 2 - 0.5;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      out[y * n + x] = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
    }
  }
  return out;
}

function ramp(colors: RGB[], t: number): RGB {
  const x = Math.min(1, Math.max(0, t)) * (colors.length - 1);
  const i = Math.min(colors.length - 2, Math.floor(x));
  const f = x - i;
  const a = colors[i];
  const b = colors[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// Light from the northwest, a bit above the horizon (y runs south in a tile).
const LIGHT = (() => {
  const v = [-1, -1, 1.1];
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
})();
const FLAT = LIGHT[2];

/**
 * A tile of landscape as RGBA pixels, from its heights (`size` × `size`, row by row from the north).
 * `low` and `high` are the course's lowest and highest ground, so the colors span the ride.
 */
export function paintLandscape(heights: ArrayLike<number>, size: number, pixelMeters: number, low: number, high: number, look: LandscapeLook): Uint8ClampedArray {
  const p = PALETTES[look];
  const out = new Uint8ClampedArray(size * size * 4);
  const interval = contourInterval(pixelMeters);
  // The land around the course matters too: let the colors run a little below and well above it.
  const span = Math.max(150, high - low);
  const base = low - span * 0.15;
  const range = span * 1.6;
  const at = (x: number, y: number) => heights[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const h = at(x, y);
      const dzdx = (at(x + 1, y) - at(x - 1, y)) / (2 * pixelMeters);
      const dzdy = (at(x, y + 1) - at(x, y - 1)) / (2 * pixelMeters);
      const len = Math.hypot(dzdx, dzdy, 1);
      const lit = (-dzdx * LIGHT[0] - dzdy * LIGHT[1] + LIGHT[2]) / len;
      // Flat ground sits at 1; slopes facing the light brighten, slopes facing away darken.
      const shade = Math.min(p.bright, Math.max(p.dark, 1 + (lit - FLAT) * 1.6));
      let [r, g, b] = ramp(p.ramp, (h - base) / range);
      r *= shade;
      g *= shade;
      b *= shade;
      const band = Math.floor(h / interval);
      if (band !== Math.floor(at(x + 1, y) / interval) || band !== Math.floor(at(x, y + 1) / interval)) {
        const upper = Math.max(band, Math.floor(at(x + 1, y) / interval), Math.floor(at(x, y + 1) / interval));
        const a = upper % 5 === 0 ? p.bold : p.line;
        r += (p.contour[0] - r) * a;
        g += (p.contour[1] - g) * a;
        b += (p.contour[2] - b) * a;
      }
      const i = (y * size + x) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
  return out;
}
