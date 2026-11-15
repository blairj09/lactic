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

/**
 * What's on the land (rivers, lakes, forests, other roads): OpenStreetMap data as vector tiles from
 * OpenFreeMap's public server, free with no account or key. The view works without it.
 */
export const FEATURE_TILES = {
  url: "https://tiles.openfreemap.org/planet",
  attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a>, data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
};
