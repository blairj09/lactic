// Where the 3D course view gets the land's heights. Open data fetched straight from its publisher to
// the rider's computer: no account, no key, nothing through Lactic. The landscape itself is drawn
// from these heights in the app (lib/ride/landscape). The host also needs allowing in the app's
// content security policy (src-tauri/tauri.conf.json).

export interface TileSource {
  /** {z}/{x}/{y} URL template. */
  tiles: string;
  maxZoom: number;
  attribution: string;
}

/** Mapzen Terrain Tiles on AWS Open Data (USGS 3DEP in the US at about 10 m, SRTM and others elsewhere at about 30 m). */
export const TERRAIN_TILES: TileSource = {
  tiles: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  maxZoom: 14,
  attribution: 'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Mapzen, USGS and others</a>',
};
