/* Runtime configuration. Paths are resolved against the site root. */
window.APP_CONFIG = {
  district: {
    name: 'อำเภอมวกเหล็ก',
    center: [101.26350735, 14.7590378],
    // optional hard bounds for panning
    maxBounds: [[100.9, 14.3], [101.62, 15.2]]
  },
  tiles: {
    // 'zxy' serves the extracted Protomaps tiles as static z/x/y.pbf files.
    // 'pmtiles' streams the single .pmtiles archive (host must support Range requests).
    mode: 'zxy',
    zxy: 'tiles/{z}/{x}/{y}.pbf',
    pmtiles: 'data/muaklek.pmtiles',
    minzoom: 0,
    maxzoom: 15,
    sourceLayerVersion: 'protomaps-basemap-4.15.2'
  },
  glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
  data: {
    points: 'data/waste-points.geojson',
    district: 'data/district.geojson',
    mask: 'data/mask.geojson',
    label: 'data/district-label.geojson'
  },
  routing: {
    valhalla: 'https://valhalla1.openstreetmap.de/route',
    osrm: 'https://router.project-osrm.org/route/v1',
    timeoutMs: 15000
  },
  geolocation: {
    timeoutMs: 12000,
    maximumAgeMs: 60000
  }
};
