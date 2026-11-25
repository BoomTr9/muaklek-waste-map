// Node 22+ | scripts/pmtiles_to_zxy.mjs
// Convert a local PMTiles archive into a static z/x/y .pbf tree.
// Usage: node scripts/pmtiles_to_zxy.mjs <input.pmtiles> <out-dir> [maxzoom]
// Run from the build/ folder where the `pmtiles` package is installed.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PMTiles, FileSource } from 'pmtiles';

const [, , input, outDir, maxZoomArg] = process.argv;
if (!input || !outDir) {
  console.error('usage: node scripts/pmtiles_to_zxy.mjs <input.pmtiles> <out-dir> [maxzoom]');
  process.exit(1);
}

const source = new FileSource(new Blob([fs.readFileSync(input)]));
const pm = new PMTiles(source);
const header = await pm.getHeader();
const maxZoom = Math.min(Number(maxZoomArg ?? header.maxZoom), header.maxZoom);
const [w, s, e, n] = [header.minLon, header.minLat, header.maxLon, header.maxLat];

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
};

let written = 0;
let empty = 0;
let bytes = 0;

for (let z = 0; z <= maxZoom; z++) {
  const x0 = lon2x(w, z);
  const x1 = lon2x(e, z);
  const y0 = lat2y(n, z);
  const y1 = lat2y(s, z);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      let data;
      try {
        const tile = await pm.getZxy(z, x, y);
        data = tile?.data;
      } catch {
        continue;
      }
      if (!data || data.byteLength === 0) {
        empty++;
        continue;
      }
      let buf = Buffer.from(data);
      if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
        buf = zlib.gunzipSync(buf);
      }
      const dir = path.join(outDir, String(z), String(x));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${y}.pbf`), buf);
      written++;
      bytes += buf.length;
    }
  }
  console.log(`z${z}: done (tiles so far: ${written})`);
}

console.log(JSON.stringify({ written, empty, megabytes: +(bytes / 1024 / 1024).toFixed(2) }));
