// Node 22+ | scripts/build_boundary.mjs
// Simplify the OSM district polygon fetched from Nominatim and build
// the site's boundary, focus-mask and label files.
// Usage: node scripts/build_boundary.mjs

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const rawPath = path.join(root, 'data', 'district-raw.geojson');
const outDir = path.join(root, 'site', 'data');
fs.mkdirSync(outDir, { recursive: true });

const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8').replace(/^﻿/, ''));
const feature = raw.features[0];
const geom = feature.geometry;

function perpDistance(p, a, b) {
  const [x, y] = p;
  const [x1, y1] = a;
  const [x2, y2] = b;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  const cx = x1 + Math.max(0, Math.min(1, t)) * dx;
  const cy = y1 + Math.max(0, Math.min(1, t)) * dy;
  return Math.hypot(x - cx, y - cy);
}

function simplify(points, tolerance) {
  if (points.length < 4) return points;
  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > tolerance) {
    const left = simplify(points.slice(0, index + 1), tolerance);
    const right = simplify(points.slice(index), tolerance);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[points.length - 1]];
}

const ringsIn = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
const rings = ringsIn.map((ring) => {
  const simplified = simplify(ring, 0.00055);
  if (simplified.length < 4) return ring;
  // Keep the ring closed.
  const first = simplified[0];
  const last = simplified[simplified.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) simplified.push(first);
  return simplified;
});

const boundary = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'อำเภอมวกเหล็ก', name_en: 'Muak Lek District' },
      geometry: { type: 'Polygon', coordinates: rings },
    },
  ],
};
fs.writeFileSync(path.join(outDir, 'district.geojson'), JSON.stringify(boundary));

// Outer ring for mask hole (largest ring).
const outer = rings.slice().sort((a, b) => b.length - a.length)[0];
const outerCW = outer.slice().reverse();
const world = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];
const mask = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [world, outerCW] },
    },
  ],
};
fs.writeFileSync(path.join(outDir, 'mask.geojson'), JSON.stringify(mask));

let minLon = 999, minLat = 999, maxLon = -999, maxLat = -999;
for (const [lon, lat] of outer) {
  minLon = Math.min(minLon, lon);
  maxLon = Math.max(maxLon, lon);
  minLat = Math.min(minLat, lat);
  maxLat = Math.max(maxLat, lat);
}
const center = [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
const label = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'อำเภอมวกเหล็ก' },
      geometry: { type: 'Point', coordinates: center },
    },
  ],
};
fs.writeFileSync(path.join(outDir, 'district-label.geojson'), JSON.stringify(label));

console.log(JSON.stringify({
  pointsIn: feature.geometry.coordinates[0].length,
  pointsOut: outer.length,
  bounds: [minLon, minLat, maxLon, maxLat],
  center,
}));
