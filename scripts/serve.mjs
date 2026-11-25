// Node 22+ | scripts/serve.mjs
// Minimal static server with HTTP Range support (needed for PMTiles mode).
// Usage: node scripts/serve.mjs [port]   (default 8080)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const port = Number(process.argv[2] || process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.pbf': 'application/vnd.mapbox-vector-tile',
  '.mvt': 'application/vnd.mapbox-vector-tile',
  '.pmtiles': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, { 'Content-Type': 'text/plain' }, 'Bad request');
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const filePath = path.resolve(root, '.' + pathname);
  if (!filePath.startsWith(root + path.sep) && filePath !== root) {
    return send(res, 403, { 'Content-Type': 'text/plain' }, 'Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': pathname.startsWith('/tiles/') ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
      'Accept-Ranges': 'bytes'
    };

    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range && stat.size > 0) {
      const [, startRaw, endRaw] = range;
      let start = startRaw === '' ? stat.size - Number(endRaw) : Number(startRaw);
      let end = endRaw === '' ? stat.size - 1 : Number(endRaw);
      start = Math.max(0, start);
      end = Math.min(stat.size - 1, end);
      if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        return res.end();
      }
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      headers['Content-Length'] = end - start + 1;
      res.writeHead(206, headers);
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }

    headers['Content-Length'] = stat.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Serving ${root}`);
  console.log(`http://localhost:${port}`);
});
