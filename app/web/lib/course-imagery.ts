// Where the 3D course view gets its land from. Everything here is open data fetched straight from
// its publisher to the rider's computer: no account, no key, nothing through Lactic. Hosts listed
// here also need allowing in the app's content security policy (src-tauri/tauri*.conf.json).

export interface TileSource {
  /** {z}/{x}/{y} URL template. */
  tiles: string;
  maxZoom: number;
  attribution: string;
}

/** Heights: Mapzen Terrain Tiles on AWS Open Data (USGS 3DEP in the US at about 10 m, SRTM and others elsewhere at about 30 m). */
export const TERRAIN_TILES: TileSource = {
  tiles: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  maxZoom: 14,
  attribution: 'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Mapzen, USGS and others</a>',
};

/** USGS aerial imagery (NAIP, about 1 m): public domain, United States only. */
export const USGS_IMAGERY: TileSource = {
  tiles: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
  maxZoom: 16,
  attribution: 'Imagery: <a href="https://www.usgs.gov/">USGS</a>',
};

/** Sentinel-2 cloudless 2016 by EOX (10 m, CC BY 4.0): the whole world, softer up close. */
export const WORLD_IMAGERY: TileSource = {
  tiles: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg",
  maxZoom: 13,
  attribution: '<a href="https://s2maps.eu">Sentinel-2 cloudless</a> by EOX (contains modified Copernicus Sentinel data 2016)',
};

/** Rough boxes for the lower 48, Alaska and Hawaii; a course outside them gets the world imagery. */
const US: [south: number, west: number, north: number, east: number][] = [
  [24.4, -125, 49.4, -66.9],
  [51, -170, 71.5, -129.9],
  [18.8, -160.3, 22.3, -154.7],
];

/** The sharpest open imagery for a place. */
export function imageryFor(lat: number, lng: number): TileSource {
  return US.some(([s, w, n, e]) => lat >= s && lat <= n && lng >= w && lng <= e) ? USGS_IMAGERY : WORLD_IMAGERY;
}
