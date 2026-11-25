// muaklek-waste-map | app.js
// MapLibre GL + static Protomaps tiles + Valhalla/OSRM routing.
// No build step: this file runs as an ES module in the browser.

const CFG = window.APP_CONFIG;

const CATEGORIES = {
  recycle: { label: 'จุดรับรีไซเคิล', color: '#177a5c', icon: 'i-recycle' },
  dropoff: { label: 'จุดทิ้งขยะ', color: '#41678f', icon: 'i-trash' },
  hazard: { label: 'ขยะอันตราย', color: '#c2762a', icon: 'i-alert' },
  facility: { label: 'ศูนย์กำจัดขยะ', color: '#6b7f6e', icon: 'i-layers' }
};
const CAT_ORDER = ['recycle', 'dropoff', 'hazard', 'facility'];
const PROFILE_LABELS = { auto: 'รถยนต์', bicycle: 'จักรยาน', pedestrian: 'เดิน' };
const G_MAPS_MODE = { auto: 'driving', bicycle: 'bicycling', pedestrian: 'walking' };
const USER_STORE = 'muaklek-waste-user-points-v1';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const el = {
  panel: $('#panel'),
  sheetHandle: $('#sheet-handle'),
  mapHint: $('#map-hint'),
  hintText: $('#hint-text'),
  hintCancel: $('#hint-cancel'),
  toast: $('#toast'),
  loading: $('#map-loading'),
  statusChip: $('#status-chip'),
  list: $('#poi-list'),
  listCount: $('#list-count'),
  filters: $('#filters'),
  originLabel: $('#origin-label'),
  destLabel: $('#dest-label'),
  routeBtn: $('#btn-route'),
  routeResult: $('#route-result'),
  routeDistance: $('#route-distance'),
  routeDuration: $('#route-duration'),
  routeSteps: $('#route-steps'),
  routeNote: $('#route-note'),
  stepsToggle: $('#btn-steps-toggle'),
  clearRoute: $('#btn-clear-route'),
  clearDest: $('#btn-clear-dest'),
  gmaps: $('#gmaps-link'),
  routeCard: $('#route-card'),
  routeToggle: $('#btn-route-toggle'),
  infoDialog: $('#info-dialog'),
  addDialog: $('#add-dialog'),
  addForm: $('#add-form'),
  addCoords: $('#add-coords-line'),
  addName: $('#add-name'),
  addCategory: $('#add-category'),
  addNote: $('#add-note'),
  addSave: $('#add-save')
};

const state = {
  features: [],
  userFeatures: [],
  filter: 'all',
  selectedId: null,
  origin: null,
  originIsDevice: false,
  dest: null,
  profile: 'auto',
  route: null,
  userLoc: null,
  pickMode: null,
  newPointCoords: null,
  mapReady: false,
  busy: false,
  markers: new Map(),
  originMarker: null,
  destMarker: null,
  popup: null
};

let map = null;
let routeRequestId = 0;
let toastTimer = null;
let initialFitDone = false;

/* ---------------- utilities ---------------- */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function svgIcon(name, cls = '') {
  return `<svg class="${cls}" aria-hidden="true"><use href="#${name}"></use></svg>`;
}

function haversine(a, b) {
  const R = 6371000;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLon = (b[0] - a[0]) * Math.PI / 180;
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function fmtDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} ม.`;
  return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} กม.`;
}

function fmtDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return 'น้อยกว่า 1 นาที';
  if (minutes < 60) return `${minutes} นาที`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} ชม. ${m} นาที` : `${h} ชม.`;
}

function absoluteUrl(path) {
  // Keep {z}/{x}/{y} placeholders unescaped for MapLibre tile templates.
  const base = new URL('.', document.baseURI).href;
  return base + String(path).replace(/^\.?\//, '');
}

function showToast(message, ms = 3600) {
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.hidden = false;
  requestAnimationFrame(() => el.toast.classList.add('show'));
  toastTimer = setTimeout(() => {
    el.toast.classList.remove('show');
    setTimeout(() => { el.toast.hidden = true; }, 220);
  }, ms);
}

function setStatusChip(text) {
  if (!el.statusChip) return;
  if (!text) {
    el.statusChip.hidden = true;
    return;
  }
  el.statusChip.textContent = text;
  el.statusChip.hidden = false;
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function featureById(id) {
  return state.features.find((f) => f.properties.id === id) || null;
}

function featureColor(feature) {
  return CATEGORIES[feature.properties.category]?.color || CATEGORIES.dropoff.color;
}

function featureIcon(feature) {
  return CATEGORIES[feature.properties.category]?.icon || 'i-trash';
}

function accuracyLabel(accuracy) {
  if (accuracy === 'pcd') return { text: 'ข้อมูลภาครัฐ', cls: 'warn' };
  if (accuracy === 'osm') return { text: 'OpenStreetMap', cls: '' };
  if (accuracy === 'user') return { text: 'จุดของคุณ', cls: 'user' };
  return null;
}

function isMobile() {
  return window.matchMedia('(max-width: 900px)').matches;
}

function setRouteExpanded(expanded) {
  if (!isMobile()) return;
  el.routeCard.classList.toggle('collapsed', !expanded);
  el.routeToggle?.setAttribute('aria-expanded', String(expanded));
}

/* ---------------- storage ---------------- */

function loadUserFeatures() {
  try {
    const raw = localStorage.getItem(USER_STORE);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((f) => f?.type === 'Feature' && f.geometry?.type === 'Point');
  } catch {
    return [];
  }
}

function saveUserFeatures() {
  try {
    localStorage.setItem(USER_STORE, JSON.stringify(state.userFeatures));
  } catch {
    showToast('บันทึกในเบราว์เซอร์ไม่สำเร็จ');
  }
  updateExportLink();
}

/* ---------------- map style ---------------- */

function buildStyle(tileSource) {
  const roadsFilter = ['!', ['in', ['get', 'kind'], ['literal', ['path', 'rail', 'ferry']]]];
  const labelField = ['coalesce', ['get', 'name:th'], ['get', 'name']];

  return {
    version: 8,
    glyphs: CFG.glyphs,
    sources: {
      basemap: tileSource,
      district: { type: 'geojson', data: absoluteUrl(CFG.data.district) },
      'focus-mask': { type: 'geojson', data: absoluteUrl(CFG.data.mask) },
      'district-label': { type: 'geojson', data: absoluteUrl(CFG.data.label) }
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#f0ede2' } },
      {
        id: 'earth', type: 'fill', source: 'basemap', 'source-layer': 'earth',
        paint: { 'fill-color': '#f6f3e9' }
      },
      {
        id: 'landcover', type: 'fill', source: 'basemap', 'source-layer': 'landcover',
        paint: {
          'fill-color': ['match', ['get', 'kind'],
            'wood', '#d6e3c4', 'forest', '#d6e3c4', 'scrub', '#e0e9d0',
            'grassland', '#e7edd7', 'wetland', '#d3e5df', 'sand', '#f0e7cd',
            'beach', '#f0e7cd', 'ice', '#f7f7f3', 'rock', '#e8e3d7',
            'rgba(0,0,0,0)'],
          'fill-opacity': 0.9
        }
      },
      {
        id: 'landuse', type: 'fill', source: 'basemap', 'source-layer': 'landuse',
        paint: {
          'fill-color': ['match', ['get', 'kind'],
            'residential', '#f1ece1', 'commercial', '#f2e8dc', 'industrial', '#e9e2d6',
            'cemetery', '#e2e7d9', 'military', '#e8e5da', 'park', '#dde8cd',
            'hospital', '#f5e9e7', 'school', '#f2ecdb', 'university', '#f2ecdb',
            'stadium', '#dfe9d2', 'golf_course', '#dce8cb', 'landfill', '#ded3c0',
            'quarry', '#e4ddcf', 'wood', '#d6e3c4', 'forest', '#d6e3c4',
            'grass', '#e3ecd4', 'grassland', '#e7edd7', 'farmland', '#eef0dd',
            'orchard', '#dfe8cd', 'meadow', '#e3ecd4', 'scrub', '#e0e9d0',
            'rgba(0,0,0,0)'],
          'fill-opacity': 0.85
        }
      },
      {
        id: 'water', type: 'fill', source: 'basemap', 'source-layer': 'water',
        filter: ['!=', ['geometry-type'], 'LineString'],
        paint: { 'fill-color': '#a9ccda' }
      },
      {
        id: 'water-lines', type: 'line', source: 'basemap', 'source-layer': 'water',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
          'line-color': '#8dbdcd',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 12, 1.2, 15, 2.6]
        }
      },
      {
        id: 'roads-casing', type: 'line', source: 'basemap', 'source-layer': 'roads',
        filter: roadsFilter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'kind'],
            'highway', '#dcb274', 'major_road', '#e3cda0',
            'medium_road', '#d9d2c1', 'minor_road', '#e2ddcf', '#ddd6c6'],
          'line-width': ['interpolate', ['linear'], ['zoom'],
            9, ['match', ['get', 'kind'], 'highway', 3, 'major_road', 2.6, 'medium_road', 2.2, 1.6],
            12, ['match', ['get', 'kind'], 'highway', 4.6, 'major_road', 4, 'medium_road', 3.1, 2.4],
            15, ['match', ['get', 'kind'], 'highway', 9.4, 'major_road', 7.6, 'medium_road', 5.6, 4.2]
          ],
          'line-opacity': 0.95
        }
      },
      {
        id: 'roads', type: 'line', source: 'basemap', 'source-layer': 'roads',
        filter: roadsFilter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'kind'],
            'highway', '#f3d49b', 'major_road', '#f7e3bd',
            'medium_road', '#fdfaf2', 'minor_road', '#fffdf8', '#fffdf8'],
          'line-width': ['interpolate', ['linear'], ['zoom'],
            9, ['match', ['get', 'kind'], 'highway', 1.3, 'major_road', 1, 'medium_road', 0.7, 0.4],
            12, ['match', ['get', 'kind'], 'highway', 3, 'major_road', 2.3, 'medium_road', 1.6, 1],
            15, ['match', ['get', 'kind'], 'highway', 7, 'major_road', 5.2, 'medium_road', 3.6, 2.2]
          ]
        }
      },
      {
        id: 'rail', type: 'line', source: 'basemap', 'source-layer': 'roads',
        filter: ['==', ['get', 'kind'], 'rail'], minzoom: 10,
        paint: {
          'line-color': '#b6b0a3', 'line-width': 1.2,
          'line-dasharray': [2.5, 2]
        }
      },
      {
        id: 'paths', type: 'line', source: 'basemap', 'source-layer': 'roads',
        filter: ['==', ['get', 'kind'], 'path'], minzoom: 13,
        paint: {
          'line-color': '#c2b69b', 'line-width': 0.9,
          'line-dasharray': [1.6, 1.6], 'line-opacity': 0.8
        }
      },
      {
        id: 'ferry', type: 'line', source: 'basemap', 'source-layer': 'roads',
        filter: ['==', ['get', 'kind'], 'ferry'],
        paint: {
          'line-color': '#7fb4c9', 'line-width': 1.2,
          'line-dasharray': [3, 2]
        }
      },
      {
        id: 'buildings', type: 'fill', source: 'basemap', 'source-layer': 'buildings', minzoom: 14,
        paint: {
          'fill-color': '#e6dfd1',
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0.3, 15.5, 0.72]
        }
      },
      {
        id: 'boundaries', type: 'line', source: 'basemap', 'source-layer': 'boundaries', minzoom: 6,
        paint: {
          'line-color': '#b7ad96',
          'line-width': 0.8,
          'line-dasharray': [2, 2],
          'line-opacity': 0.55
        }
      },
      {
        id: 'focus-mask', type: 'fill', source: 'focus-mask',
        paint: { 'fill-color': '#223a2e', 'fill-opacity': 0.13 }
      },
      {
        id: 'district-outline', type: 'line', source: 'district',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#2f6d57',
          'line-width': 1.6,
          'line-opacity': 0.8,
          'line-dasharray': [2.4, 1.6]
        }
      },
      {
        id: 'place-towns', type: 'symbol', source: 'basemap', 'source-layer': 'places',
        minzoom: 9,
        filter: ['all',
          ['==', ['geometry-type'], 'Point'],
          ['in', ['get', 'kind_detail'], ['literal', ['city', 'town']]],
          ['has', 'name']
        ],
        layout: {
          'text-field': labelField,
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 12.5, 12, 14, 15.5, 15.5],
          'text-padding': 4,
          'text-allow-overlap': false
        },
        paint: {
          'text-color': '#3c3a30',
          'text-halo-color': '#f8f5ea',
          'text-halo-width': 1.5,
          'text-halo-blur': 0.4,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 11, 1]
        }
      },
      {
        id: 'place-villages', type: 'symbol', source: 'basemap', 'source-layer': 'places',
        minzoom: 11,
        filter: ['all',
          ['==', ['geometry-type'], 'Point'],
          ['==', ['get', 'kind_detail'], 'village'],
          ['has', 'name']
        ],
        layout: {
          'text-field': labelField,
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10.5, 15.5, 13],
          'text-padding': 3,
          'text-allow-overlap': false
        },
        paint: {
          'text-color': '#46443a',
          'text-halo-color': '#f8f5ea',
          'text-halo-width': 1.3,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 12.5, 1]
        }
      },
      {
        id: 'place-hamlets', type: 'symbol', source: 'basemap', 'source-layer': 'places',
        minzoom: 13,
        filter: ['all',
          ['==', ['geometry-type'], 'Point'],
          ['in', ['get', 'kind_detail'], ['literal', ['hamlet', 'suburb', 'neighbourhood', 'quarter', 'isolated_dwelling']]],
          ['has', 'name']
        ],
        layout: {
          'text-field': labelField,
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 15.5, 12],
          'text-padding': 3,
          'text-allow-overlap': false
        },
        paint: {
          'text-color': '#5c594c',
          'text-halo-color': '#f8f5ea',
          'text-halo-width': 1.2,
          'text-opacity': 0.9
        }
      },
      {
        id: 'road-labels', type: 'symbol', source: 'basemap', 'source-layer': 'roads',
        minzoom: 12.6,
        filter: ['all',
          ['in', ['get', 'kind'], ['literal', ['highway', 'major_road']]],
          ['has', 'name']
        ],
        layout: {
          'symbol-placement': 'line',
          'text-field': labelField,
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 12.6, 9.5, 15, 11.5],
          'text-rotation-alignment': 'map',
          'text-pitch-alignment': 'map',
          'text-max-angle': 30,
          'text-padding': 4
        },
        paint: {
          'text-color': '#6d6350',
          'text-halo-color': '#faf7ee',
          'text-halo-width': 1.3
        }
      },
      {
        id: 'district-label', type: 'symbol', source: 'district-label',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Medium'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 12, 12, 14],
          'text-letter-spacing': 0.06,
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#2b5f4c',
          'text-halo-color': '#f4f1e5',
          'text-halo-width': 2,
          'text-opacity': 0.85
        }
      }
    ]
  };
}

/* ---------------- map ---------------- */

async function createBaseSource() {
  const mode = new URLSearchParams(location.search).get('tiles') || CFG.tiles.mode;
  if (mode === 'pmtiles') {
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/pmtiles@4.5.0/+esm');
      const protocol = new mod.Protocol();
      maplibregl.addProtocol('pmtiles', protocol.tile);
      return {
        type: 'vector',
        url: `pmtiles://${absoluteUrl(CFG.tiles.pmtiles)}`,
        minzoom: CFG.tiles.minzoom,
        maxzoom: CFG.tiles.maxzoom,
        attribution: '© OpenStreetMap contributors · Protomaps'
      };
    } catch (err) {
      console.warn('pmtiles mode unavailable, falling back to zxy tiles', err);
    }
  }
  return {
    type: 'vector',
    tiles: [absoluteUrl(CFG.tiles.zxy)],
    minzoom: CFG.tiles.minzoom,
    maxzoom: CFG.tiles.maxzoom,
    attribution: '© OpenStreetMap contributors · Protomaps'
  };
}

async function initMap(district) {
  const baseSource = await createBaseSource();
  map = new maplibregl.Map({
    container: 'map',
    style: buildStyle(baseSource),
    center: CFG.district.center,
    zoom: 10.6,
    minZoom: 8,
    maxZoom: 17,
    maxBounds: CFG.district.maxBounds,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    attributionControl: { compact: true },
    antialias: true
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');

  map.on('error', (event) => {
    const status = event?.error?.status;
    if (!status || status !== 404) console.error('Map error', event?.error?.message || event?.error || event);
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('map load timeout')), 25000);
    map.once('load', () => { clearTimeout(timer); resolve(); });
  });

  map.addSource('route', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });
  map.addLayer({
    id: 'route-casing', type: 'line', source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.92 }
  });
  map.addLayer({
    id: 'route-line', type: 'line', source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#0f6b52', 'line-width': 5 }
  });

  state.mapReady = true;
  hideLoading();
  fitDistrict(false);
}

function hideLoading() {
  el.loading.classList.add('done');
  setTimeout(() => { el.loading.hidden = true; }, 400);
}

function mapPadding(extraBottom = 0, fullPanel = false) {
  if (isMobile()) {
    const panelHeight = el.panel.classList.contains('expanded') ? window.innerHeight * 0.86 : window.innerHeight * 0.46;
    const bottom = fullPanel
      ? Math.min(panelHeight, window.innerHeight * 0.55)
      : panelHeight * 0.72;
    return { top: 84, bottom: Math.round(bottom) + extraBottom, left: 28, right: 28 };
  }
  return { top: 60, bottom: 60 + extraBottom, left: 60, right: 60 };
}

function fitDistrict(animate = true) {
  if (!map) return;
  const coords = [];
  state.districtFeature?.geometry?.coordinates?.forEach((ring) => ring.forEach((c) => coords.push(c)));
  if (!coords.length) {
    map.easeTo({ center: CFG.district.center, zoom: 10.6, duration: animate ? 600 : 0 });
    return;
  }
  let minLng = 999, minLat = 999, maxLng = -999, maxLat = -999;
  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
    padding: mapPadding(),
    duration: animate ? 700 : 0,
    maxZoom: 11.4
  });
}

function updateHash(id) {
  try {
    if (id) history.replaceState(null, '', `#p=${encodeURIComponent(id)}`);
    else history.replaceState(null, '', location.pathname + location.search);
  } catch { /* noop */ }
}

/* ---------------- markers, popup ---------------- */

function popupHtml(feature) {
  const p = feature.properties;
  const cat = CATEGORIES[p.category] || CATEGORIES.dropoff;
  const [lng, lat] = feature.geometry.coordinates;
  const acc = accuracyLabel(p.accuracy);
  const gmapsHref = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  return `
    <div class="popup-card" style="--cat:${cat.color}">
      <div class="popup-top">
        <span class="popup-icon">${svgIcon(cat.icon)}</span>
        <div style="min-width:0">
          <div class="popup-name">${escapeHtml(p.name)}</div>
          <div class="popup-cat">${escapeHtml(cat.label)}${acc ? ` · ${acc.text}` : ''}</div>
        </div>
      </div>
      ${p.address ? `<div class="popup-line">${svgIcon('i-pin')}<span>${escapeHtml(p.address)}</span></div>` : ''}
      ${p.hours ? `<div class="popup-line">${svgIcon('i-clock')}<span>${escapeHtml(p.hours)}</span></div>` : ''}
      ${p.note ? `<div class="popup-line"><span>${escapeHtml(p.note)}</span></div>` : ''}
      <div class="popup-actions">
        <button class="btn btn-primary" data-popup-route="${escapeHtml(p.id)}">${svgIcon('i-route')} นำทาง</button>
        <a class="btn" href="${gmapsHref}" target="_blank" rel="noopener">${svgIcon('i-external')} แผนที่</a>
      </div>
    </div>`;
}

function openPopup(feature, options = {}) {
  if (!map) return;
  state.popup?.remove();
  const [lng, lat] = feature.geometry.coordinates;
  const popup = new maplibregl.Popup({
    offset: 22,
    closeButton: false,
    maxWidth: '300px',
    className: 'poi-popup',
    focusAfterOpen: false
  })
    .setLngLat([lng, lat])
    .setHTML(popupHtml(feature))
    .addTo(map);

  const root = popup.getElement();
  const btn = root?.querySelector('[data-popup-route]');
  btn?.addEventListener('click', () => {
    const f = featureById(btn.getAttribute('data-popup-route'));
    if (f) {
      popup.remove();
      beginRoute(f);
    }
  });
  if (options.closeOnMapClick !== false) {
    map.once('click', () => popup.remove());
  }
  if (isMobile()) {
    requestAnimationFrame(() => {
      const popupEl = popup.getElement();
      if (!popupEl) return;
      const rect = popupEl.getBoundingClientRect();
      const panelTop = el.panel.getBoundingClientRect().top;
      const overflow = rect.bottom - (panelTop - 12);
      if (overflow > 0) map.panBy([0, Math.ceil(overflow)], { duration: 280 });
    });
  }
  state.popup = popup;
}

function buildMarker(feature) {
  const p = feature.properties;
  const cat = CATEGORIES[p.category] || CATEGORIES.dropoff;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'marker' + (p.accuracy === 'user' ? ' user-made' : '');
  btn.dataset.cat = p.category;
  btn.dataset.id = p.id;
  btn.setAttribute('aria-label', `${p.name} — ${cat.label}`);
  btn.innerHTML = `
    <span class="marker-pin">${svgIcon(cat.icon)}</span>
    <span class="marker-label">${escapeHtml(p.short_name || p.name)}</span>`;
  const marker = new maplibregl.Marker({ element: btn, anchor: 'top', offset: [0, -17] })
    .setLngLat(feature.geometry.coordinates)
    .addTo(map);
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    selectPoint(p.id, { fly: false, popup: true, scrollList: false });
  });
  return marker;
}

function renderMarkers() {
  for (const marker of state.markers.values()) marker.remove();
  state.markers.clear();
  state.features.forEach((feature) => {
    const marker = buildMarker(feature);
    state.markers.set(feature.properties.id, marker);
  });
  applyMarkerVisibility();
}

function applyMarkerVisibility() {
  for (const [id, marker] of state.markers.entries()) {
    const f = featureById(id);
    const visible = !!f && (state.filter === 'all' || f.properties.category === state.filter);
    marker.getElement().style.display = visible ? '' : 'none';
  }
}

/* ---------------- selection ---------------- */

function selectPoint(id, opts = {}) {
  const feature = featureById(id);
  if (!feature) return;
  state.selectedId = id;

  $$('.poi').forEach((li) => li.classList.toggle('selected', li.getAttribute('data-id') === id));
  for (const [markerId, marker] of state.markers.entries()) {
    marker.getElement().classList.toggle('selected', markerId === id);
  }

  if (opts.fly) {
    map.flyTo({
      center: feature.geometry.coordinates,
      zoom: Math.max(map.getZoom(), 13.2),
      offset: isMobile() ? [0, -60] : [0, -80],
      speed: 0.9,
      duration: 700
    });
  }
  if (opts.popup) openPopup(feature);
  if (opts.scrollList) {
    const li = document.querySelector(`.poi[data-id="${CSS.escape(id)}"]`);
    li?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  updateHash(id);
}

function clearSelection() {
  state.selectedId = null;
  $$('.poi').forEach((li) => li.classList.remove('selected'));
  for (const marker of state.markers.values()) marker.getElement().classList.remove('selected');
  state.popup?.remove();
}

/* ---------------- list and filters ---------------- */

function getVisibleFeatures() {
  let list = state.features.filter((f) => state.filter === 'all' || f.properties.category === state.filter);
  const origin = state.userLoc || state.origin;
  if (origin) {
    list = list
      .map((f) => ({ f, d: haversine(origin, f.geometry.coordinates) }))
      .sort((a, b) => a.d - b.d)
      .map((x) => x.f);
  } else {
    const rank = (f) => CAT_ORDER.indexOf(f.properties.category);
    list = list.slice().sort((a, b) => rank(a) - rank(b) || String(a.properties.name).localeCompare(String(b.properties.name), 'th'));
  }
  return list;
}

function renderFilters() {
  const counts = {};
  for (const f of state.features) counts[f.properties.category] = (counts[f.properties.category] || 0) + 1;
  const parts = [];
  parts.push(`<button class="filter-chip ${state.filter === 'all' ? 'active' : ''}" data-filter="all" aria-pressed="${state.filter === 'all'}">
      ทั้งหมด <span class="count">${state.features.length}</span></button>`);
  for (const key of CAT_ORDER) {
    if (!counts[key]) continue;
    const cat = CATEGORIES[key];
    parts.push(`<button class="filter-chip ${state.filter === key ? 'active' : ''}" data-filter="${key}" style="--c:${cat.color}" aria-pressed="${state.filter === key}">
      <span class="dot"></span>${cat.label} <span class="count">${counts[key]}</span></button>`);
  }
  el.filters.innerHTML = parts.join('');
}

function poiItemHtml(feature) {
  const p = feature.properties;
  const cat = CATEGORIES[p.category] || CATEGORIES.dropoff;
  const origin = state.userLoc || state.origin;
  const distance = origin ? haversine(origin, feature.geometry.coordinates) : null;
  const acc = accuracyLabel(p.accuracy);
  const tags = [`<span class="tag cat" style="--cat:${cat.color}">${escapeHtml(cat.label)}</span>`];
  if (acc) tags.push(`<span class="tag ${acc.cls}">${acc.text}</span>`);
  return `
    <li class="poi ${state.selectedId === p.id ? 'selected' : ''}" data-id="${escapeHtml(p.id)}">
      <button class="poi-main" type="button" data-select="${escapeHtml(p.id)}">
        <span class="poi-icon" style="--cat:${cat.color}">${svgIcon(cat.icon)}</span>
        <span class="poi-body">
          <span class="poi-name">${escapeHtml(p.name)}</span>
          <span class="poi-meta">${escapeHtml(p.address || '')}</span>
          <span class="poi-tags">${tags.join('')}</span>
        </span>
      </button>
      <span class="poi-side">
        ${distance != null ? `<span class="poi-dist">${fmtDistance(distance)}</span>` : '<span class="poi-dist"></span>'}
        <span style="display:flex;align-items:center;gap:4px">
          ${p.accuracy === 'user' ? `<button class="poi-del" data-delete="${escapeHtml(p.id)}" title="ลบจุดนี้">ลบ</button>` : ''}
          <button class="poi-go" data-route="${escapeHtml(p.id)}" aria-label="นำทางไป ${escapeHtml(p.name)}" title="นำทาง">
            ${svgIcon('i-route')}
          </button>
        </span>
      </span>
    </li>`;
}

function renderList() {
  const list = getVisibleFeatures();
  el.listCount.textContent = list.length ? `${list.length} จุดในอำเภอมวกเหล็ก` : 'ไม่พบจุดในหมวดนี้';
  if (!list.length) {
    el.list.innerHTML = `<li class="empty-state">ยังไม่มีจุดในหมวดนี้ — ใช้ “เพิ่มจุด” เพื่อปักหมุดจุดที่คุณรู้จัก</li>`;
    return;
  }
  el.list.innerHTML = list.map(poiItemHtml).join('');
}

function refreshAll() {
  if (state.filter !== 'all' && !state.features.some((f) => f.properties.category === state.filter)) {
    state.filter = 'all';
  }
  renderFilters();
  renderList();
  renderMarkers();
  applyMarkerVisibility();
}

/* ---------------- origin / geolocation ---------------- */

function setOriginMarker(coords) {
  if (!map) return;
  state.originMarker?.remove();
  const elm = document.createElement('div');
  elm.className = 'route-pin';
  state.originMarker = new maplibregl.Marker({ element: elm, anchor: 'center' })
    .setLngLat(coords)
    .addTo(map);
}

function setDestMarker(coords) {
  if (!map) return;
  state.destMarker?.remove();
  const elm = document.createElement('div');
  elm.className = 'route-pin end';
  state.destMarker = new maplibregl.Marker({ element: elm, anchor: 'center' })
    .setLngLat(coords)
    .addTo(map);
}

function clearDestMarker() {
  state.destMarker?.remove();
  state.destMarker = null;
}

function setOrigin(coords, { device = false, moveMap = false } = {}) {
  state.origin = coords;
  state.originIsDevice = device;
  el.originLabel.textContent = device ? 'ตำแหน่งของฉัน' : 'จุดที่เลือกบนแผนที่';
  setOriginMarker(coords);
  renderList();
  if (moveMap) map?.easeTo({ center: coords, zoom: Math.max(map.getZoom(), 13), duration: 600 });
}

function clearOrigin() {
  state.origin = null;
  state.originIsDevice = false;
  state.originMarker?.remove();
  state.originMarker = null;
  el.originLabel.textContent = 'ยังไม่ได้ระบุ';
  renderList();
}

function locateMe({ silent = false, fly = false } = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      if (!silent) showToast('เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง');
      resolve(false);
      return;
    }
    setStatusChip('กำลังหาตำแหน่ง…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = [pos.coords.longitude, pos.coords.latitude];
        state.userLoc = coords;
        setOrigin(coords, { device: true, moveMap: fly });
        setStatusChip('ตำแหน่งพร้อมใช้งาน');
        setTimeout(() => setStatusChip(''), 5000);
        renderList();
        resolve(true);
      },
      (err) => {
        setStatusChip('');
        const message = err.code === 1
          ? 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง — เลือกจุดเริ่มบนแผนที่แทน'
          : err.code === 3
            ? 'หาตำแหน่งไม่สำเร็จภายในเวลา — ลองอีกครั้ง'
            : 'ระบุตำแหน่งไม่สำเร็จ';
        if (!silent) showToast(message);
        resolve(false);
      },
      {
        enableHighAccuracy: true,
        timeout: CFG.geolocation.timeoutMs,
        maximumAge: CFG.geolocation.maximumAgeMs
      }
    );
  });
}

/* ---------------- pick modes ---------------- */

function setPickMode(mode, hint) {
  clearPickMode();
  state.pickMode = mode;
  el.hintText.textContent = hint;
  el.mapHint.hidden = false;
  map?.getCanvas().classList.add('picking');
  if (map) map.getCanvas().style.cursor = 'crosshair';
}

function clearPickMode() {
  state.pickMode = null;
  state.newPointCoords = null;
  el.mapHint.hidden = true;
  if (map) map.getCanvas().style.cursor = '';
}

function cancelPickMode() {
  if (state.pickMode === 'new-point') {
    el.addDialog.close('cancel');
  }
  clearPickMode();
}

/* ---------------- routing ---------------- */

function decodePolyline(str, precision = 1e6) {
  let index = 0, lat = 0, lng = 0;
  const coordinates = [];
  while (index < str.length) {
    let shift = 0, result = 0, byte;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;

    shift = 0; result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;

    coordinates.push([lng / precision, lat / precision]);
  }
  return coordinates;
}

const TH_MANEUVER = {
  1: 'เริ่มต้น', 2: 'เริ่มต้น', 3: 'เริ่มต้น', 4: 'ถึงจุดหมาย',
  7: 'ตรงไปตามเส้นทาง', 8: 'ไปตามเส้นทาง', 9: 'เลี้ยวขวาเล็กน้อย',
  10: 'เลี้ยวขวา', 11: 'เลี้ยวขวาหักศอก', 12: 'กลับรถ', 13: 'กลับรถ',
  14: 'เลี้ยวซ้ายหักศอก', 15: 'เลี้ยวซ้าย', 16: 'เลี้ยวซ้ายเล็กน้อย',
  17: 'ขึ้นทางลาด', 18: 'ออกทางขวา', 19: 'ออกทางซ้าย',
  20: 'ออกทางขวา', 21: 'ออกทางซ้าย', 22: 'ตรงไป', 23: 'ชิดขวา',
  24: 'ชิดซ้าย', 25: 'รวมทาง', 26: 'เข้าสู่ทางเวียน', 27: 'ออกจากทางเวียน',
  28: 'ขึ้นเรือเฟอร์รี', 29: 'ลงเรือเฟอร์รี'
};

function streetName(maneuver) {
  if (Array.isArray(maneuver.street_names) && maneuver.street_names[0]) return maneuver.street_names[0];
  if (Array.isArray(maneuver.street) && maneuver.street[0]) return maneuver.street[0];
  if (typeof maneuver.street === 'string' && maneuver.street.trim()) return maneuver.street;
  const text = maneuver.instruction || '';
  const match = /(?:onto|on|to stay on|to)\s+(.+?)\.?$/i.exec(text);
  return match ? match[1].replace(/\s+for\s+.*$/i, '').trim() : '';
}

function valhallaInstruction(maneuver) {
  const base = TH_MANEUVER[maneuver.type] || 'ไปตามเส้นทาง';
  const street = streetName(maneuver);
  if (maneuver.type <= 3) return street ? `${base} ที่ ${street}` : base;
  if (maneuver.type === 4) return base;
  if (maneuver.type === 27 && maneuver.roundabout_exit_count) {
    return `${base} ทางออกที่ ${maneuver.roundabout_exit_count}`;
  }
  if (maneuver.type === 26 || !street) return base;
  return `${base} เข้าสู่ ${street}`;
}

function osrmInstruction(step) {
  const type = step.maneuver?.type || '';
  const modifier = step.maneuver?.modifier || '';
  const name = step.name ? `เข้าสู่ ${step.name}` : '';
  const mods = {
    left: 'ซ้าย', right: 'ขวา', 'slight left': 'ซ้ายเล็กน้อย',
    'slight right': 'ขวาเล็กน้อย', 'sharp left': 'ซ้ายหักศอก',
    'sharp right': 'ขวาหักศอก', straight: 'ตรงไป', uturn: 'กลับรถ'
  };
  switch (type) {
    case 'depart': return `เริ่มต้น${step.name ? `ที่ ${step.name}` : ''}`;
    case 'arrive': return 'ถึงจุดหมาย';
    case 'turn': return `เลี้ยว${mods[modifier] || ''} ${name}`.trim();
    case 'new name': return `ตรงไป${step.name ? `ตาม ${step.name}` : ''}`;
    case 'merge': return `รวมทาง${name}`;
    case 'on ramp': return `ขึ้นทางลาด${name}`;
    case 'off ramp': return `ลงทางลาด${name}`;
    case 'fork': return `แยก${mods[modifier] || ''} ${name}`.trim();
    case 'roundabout': return `เข้าสู่ทางเวียน${step.maneuver.exit ? ` ออกทางออกที่ ${step.maneuver.exit}` : ''}`;
    case 'end of road': return `สุดถนน แล้วเลี้ยว${mods[modifier] || ''} ${name}`.trim();
    case 'continue': return `ไปตาม${step.name ? ` ${step.name}` : 'เส้นทาง'}`;
    default: return step.name ? `ไปตาม ${step.name}` : 'ไปตามเส้นทาง';
  }
}

async function routeValhalla(start, end, profile) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CFG.routing.timeoutMs);
  try {
    const res = await fetch(CFG.routing.valhalla, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations: [
          { lat: start[1], lon: start[0] },
          { lat: end[1], lon: end[0] }
        ],
        costing: profile,
        units: 'kilometers',
        directions_options: { units: 'kilometers' }
      }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Valhalla ${res.status}`);
    const data = await res.json();
    if (!data?.trip?.legs?.[0]) throw new Error('Valhalla empty trip');
    const leg = data.trip.legs[0];
    return {
      source: 'valhalla',
      distance: data.trip.summary.length * 1000,
      duration: data.trip.summary.time,
      geometry: decodePolyline(leg.shape, 1e6),
      steps: (leg.maneuvers || []).map((m) => ({
        text: valhallaInstruction(m),
        distance: (m.length || 0) * 1000,
        duration: m.time || 0
      }))
    };
  } finally {
    clearTimeout(timer);
  }
}

async function routeOSRM(start, end) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CFG.routing.timeoutMs);
  try {
    const url = `${CFG.routing.osrm}/driving/${start[0]},${start[1]};${end[0]},${end[1]}?overview=full&geometries=geojson&steps=true`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route) throw new Error('OSRM empty route');
    return {
      source: 'osrm',
      distance: route.distance,
      duration: route.duration,
      geometry: route.geometry.coordinates,
      steps: (route.legs?.[0]?.steps || []).map((s) => ({
        text: osrmInstruction(s),
        distance: s.distance || 0,
        duration: s.duration || 0
      }))
    };
  } finally {
    clearTimeout(timer);
  }
}

function estimateRoute(start, end, profile) {
  const straight = haversine(start, end) * 1.35;
  const speeds = { auto: 45, bicycle: 16, pedestrian: 4.8 };
  const speed = speeds[profile] || 40;
  return {
    source: 'estimate',
    distance: straight,
    duration: straight / 1000 / speed * 3600,
    geometry: [start, end],
    steps: [{ text: `มุ่งหน้าสู่จุดหมายโดยประมาณ ${fmtDistance(straight)}`, distance: straight, duration: straight / 1000 / speed * 3600 }]
  };
}

async function computeRoute() {
  if (state.busy) return;
  if (!state.dest) {
    showToast('เลือกจุดหมายก่อน — แตะ “นำทาง” ที่รายการ');
    return;
  }
  if (!state.origin) {
    const ok = await locateMe({ silent: true });
    if (!ok) {
      setRouteExpanded(true);
      setPickMode('origin', 'แตะแผนที่เพื่อตั้งจุดเริ่มต้น');
      showToast('ไม่พบตำแหน่งของคุณ — แตะแผนที่เพื่อตั้งจุดเริ่ม');
      return;
    }
  }

  const requestId = ++routeRequestId;
  state.busy = true;
  const originalLabel = el.routeBtn.textContent;
  el.routeBtn.disabled = true;
  el.routeBtn.textContent = 'กำลังคำนวณ…';
  state.popup?.remove();

  const start = state.origin;
  const end = state.dest.geometry.coordinates;
  let route = null;

  try {
    route = await routeValhalla(start, end, state.profile);
  } catch (err) {
    console.warn('Valhalla failed', err);
  }
  if (!route && state.profile === 'auto') {
    try {
      route = await routeOSRM(start, end);
    } catch (err) {
      console.warn('OSRM failed', err);
    }
  }
  if (!route) route = estimateRoute(start, end, state.profile);

  if (requestId !== routeRequestId) return;
  state.route = route;
  state.busy = false;
  el.routeBtn.disabled = false;
  el.routeBtn.textContent = originalLabel;

  drawRoute(route, start, end);
  renderRouteResult(route);
}

function drawRoute(route, start, end) {
  if (!map) return;
  const source = map.getSource('route');
  source?.setData({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: route.geometry }
    }]
  });
  map.setPaintProperty('route-line', 'line-color', route.source === 'estimate' ? '#b77828' : '#0f6b52');
  map.setPaintProperty('route-line', 'line-dasharray', route.source === 'estimate' ? [2, 1.4] : null);

  setOriginMarker(start);
  setDestMarker(end);

  const coords = route.geometry;
  let minLng = 999, minLat = 999, maxLng = -999, maxLat = -999;
  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
    padding: mapPadding(24, true),
    duration: 800,
    maxZoom: 15
  });
}

function renderRouteResult(route) {
  el.routeResult.hidden = false;
  el.routeDistance.textContent = fmtDistance(route.distance);
  el.routeDuration.textContent = fmtDuration(route.duration);
  el.routeNote.className = 'route-note' + (route.source === 'estimate' ? ' warn' : '');
  el.routeNote.textContent = route.source === 'valhalla'
    ? 'เส้นทางจาก Valhalla · เวลาเป็นค่าประมาณจากความเร็วถนน'
    : route.source === 'osrm'
      ? 'เส้นทางจาก OSRM (เซิร์ฟเวอร์สำรอง) · เวลาเป็นค่าประมาณ'
      : 'บริการเส้นทางไม่ตอบสนอง — แสดงเส้นตรงเพื่อประมาณการ ควรเปิดใน Google Maps อีกครั้ง';

  const start = state.origin;
  const end = state.dest.geometry.coordinates;
  el.gmaps.href = `https://www.google.com/maps/dir/?api=1&origin=${start[1]},${start[0]}&destination=${end[1]},${end[0]}&travelmode=${G_MAPS_MODE[state.profile] || 'driving'}`;

  el.routeSteps.innerHTML = route.steps.map((step, i) => `
    <li>
      <span class="step-num">${i + 1}</span>
      <span class="step-text">${escapeHtml(step.text)}<br><span class="step-meta">${fmtDistance(step.distance)} · ${fmtDuration(step.duration)}</span></span>
    </li>`).join('');
  el.stepsToggle.setAttribute('aria-expanded', 'false');
  el.routeSteps.hidden = true;
  el.clearRoute.hidden = false;
  el.clearDest.hidden = false;
  if (isMobile() && route.source !== 'estimate') {
    showToast(`${fmtDistance(route.distance)} · ${fmtDuration(route.duration)}`, 2600);
  }
}

function clearRoute({ clearDestination = true } = {}) {
  routeRequestId++;
  state.route = null;
  state.busy = false;
  map?.getSource('route')?.setData({ type: 'FeatureCollection', features: [] });
  clearDestMarker();
  el.routeResult.hidden = true;
  el.clearRoute.hidden = true;
  el.routeBtn.disabled = false;
  el.routeBtn.textContent = 'คำนวณเส้นทาง';
  if (clearDestination) {
    state.dest = null;
    el.destLabel.textContent = 'แตะ “นำทาง” ที่รายการด้านล่าง';
    el.clearDest.hidden = true;
  }
}

function beginRoute(feature) {
  if (!feature) return;
  clearRoute({ clearDestination: true });
  state.dest = feature;
  el.destLabel.textContent = feature.properties.name;
  setDestMarker(feature.geometry.coordinates);
  el.clearDest.hidden = false;
  setRouteExpanded(true);
  if (isMobile()) {
    el.panel.classList.remove('expanded');
    el.panel.scrollTo({ top: 0, behavior: 'smooth' });
  }
  selectPoint(feature.properties.id, { scrollList: false });
  computeRoute();
}

/* ---------------- add point ---------------- */

function openAddDialog(coords) {
  state.newPointCoords = coords;
  el.addCoords.textContent = `ตำแหน่ง: ${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}`;
  el.addName.value = '';
  el.addNote.value = '';
  el.addSave.disabled = false;
  el.addDialog.showModal();
  setTimeout(() => el.addName.focus(), 50);
}

function saveUserPoint() {
  const name = el.addName.value.trim();
  if (!name) {
    showToast('กรอกชื่อจุดก่อน');
    el.addName.focus();
    return;
  }
  if (!state.newPointCoords) {
    showToast('ยังไม่ได้เลือกตำแหน่ง');
    return;
  }
  const category = el.addCategory.value;
  const feature = {
    type: 'Feature',
    properties: {
      id: `user-${Date.now()}`,
      name,
      category,
      address: 'จุดที่คุณเพิ่ม',
      hours: '',
      accepts: [],
      note: el.addNote.value.trim(),
      accuracy: 'user',
      source_label: 'เพิ่มโดยผู้ใช้',
      updated: new Date().toISOString().slice(0, 10)
    },
    geometry: { type: 'Point', coordinates: state.newPointCoords }
  };
  state.userFeatures.push(feature);
  state.features.push(feature);
  saveUserFeatures();
  refreshAll();
  el.addDialog.close('saved');
  clearPickMode();
  selectPoint(feature.properties.id, { fly: true, popup: true });
  showToast('เพิ่มจุดแล้ว — เก็บไว้ในเบราว์เซอร์นี้');
}

function deleteUserPoint(id) {
  const feature = featureById(id);
  if (!feature || feature.properties.accuracy !== 'user') return;
  if (!window.confirm(`ลบ “${feature.properties.name}” ออกจากแผนที่ของคุณ?`)) return;
  state.userFeatures = state.userFeatures.filter((f) => f.properties.id !== id);
  state.features = state.features.filter((f) => f.properties.id !== id);
  saveUserFeatures();
  if (state.dest?.properties.id === id) clearRoute();
  if (state.selectedId === id) clearSelection();
  refreshAll();
  updateHash('');
  showToast('ลบจุดแล้ว');
}

function updateExportLink() {
  const link = document.getElementById('btn-export');
  if (!link) return;
  const hasUser = state.userFeatures.length > 0;
  link.hidden = !hasUser;
}

function exportUserPoints() {
  if (!state.userFeatures.length) {
    showToast('ยังไม่มีจุดที่คุณเพิ่ม');
    return;
  }
  const data = { type: 'FeatureCollection', features: state.userFeatures };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'muaklek-waste-points-user.geojson';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast('ดาวน์โหลด GeoJSON แล้ว');
}

/* ---------------- event wiring ---------------- */

function wireEvents() {
  el.list.addEventListener('click', (event) => {
    const del = event.target.closest('[data-delete]');
    if (del) {
      deleteUserPoint(del.getAttribute('data-delete'));
      return;
    }
    const routeBtn = event.target.closest('[data-route]');
    if (routeBtn) {
      const f = featureById(routeBtn.getAttribute('data-route'));
      if (f) beginRoute(f);
      return;
    }
    const select = event.target.closest('[data-select]');
    if (select) {
      selectPoint(select.getAttribute('data-select'), { fly: true, popup: true, scrollList: false });
    }
  });

  el.filters.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    state.filter = chip.getAttribute('data-filter');
    renderFilters();
    renderList();
    applyMarkerVisibility();
  });

  el.sheetHandle.addEventListener('click', () => {
    const expanded = el.panel.classList.toggle('expanded');
    el.sheetHandle.setAttribute('aria-expanded', String(expanded));
  });

  el.routeToggle?.addEventListener('click', () => {
    const collapsed = el.routeCard.classList.contains('collapsed');
    setRouteExpanded(collapsed);
  });

  $('#btn-origin-me').addEventListener('click', async () => {
    setRouteExpanded(true);
    const ok = await locateMe({ fly: true });
    if (ok && state.dest) computeRoute();
  });
  $('#btn-origin-map').addEventListener('click', () => {
    setRouteExpanded(true);
    setPickMode('origin', 'แตะแผนที่เพื่อตั้งจุดเริ่มต้น');
  });
  $('#btn-locate').addEventListener('click', async () => {
    const ok = await locateMe({ fly: true });
    if (ok && state.dest) {
      setRouteExpanded(true);
      computeRoute();
    }
  });

  el.hintCancel.addEventListener('click', cancelPickMode);
  el.routeBtn.addEventListener('click', computeRoute);
  el.clearRoute.addEventListener('click', () => {
    clearRoute();
    updateHash(state.selectedId || '');
  });
  el.clearDest.addEventListener('click', () => {
    clearRoute();
  });
  el.stepsToggle.addEventListener('click', () => {
    const show = el.routeSteps.hidden;
    el.routeSteps.hidden = !show;
    el.stepsToggle.setAttribute('aria-expanded', String(show));
  });

  $$('.profile-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.profile = btn.dataset.profile;
      $$('.profile-btn').forEach((b) => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      if (state.route && state.origin && state.dest) computeRoute();
    });
  });

  $('#btn-add').addEventListener('click', () => {
    setPickMode('new-point', 'แตะตำแหน่งจุดใหม่ของคุณบนแผนที่');
    setRouteExpanded(false);
    if (isMobile()) el.panel.classList.remove('expanded');
    showToast('แตะบนแผนที่ตรงตำแหน่งจุดที่ต้องการเพิ่ม');
  });

  $('#btn-info').addEventListener('click', () => el.infoDialog.showModal());
  $('#btn-info-2').addEventListener('click', () => el.infoDialog.showModal());

  el.addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    saveUserPoint();
  });
  $$('#add-dialog [data-close-add]').forEach((btn) => {
    btn.addEventListener('click', () => el.addDialog.close('cancel'));
  });
  el.addDialog.addEventListener('close', () => {
    if (el.addDialog.returnValue !== 'saved') clearPickMode();
  });

  map?.on('click', (event) => {
    if (!state.pickMode) {
      state.popup?.remove();
      return;
    }
    const coords = [event.lngLat.lng, event.lngLat.lat];
    if (state.pickMode === 'origin') {
      setOrigin(coords);
      clearPickMode();
      if (state.dest) computeRoute();
      showToast('ตั้งจุดเริ่มต้นแล้ว');
    } else if (state.pickMode === 'new-point') {
      clearPickMode();
      openAddDialog(coords);
    }
  });

  window.addEventListener('hashchange', () => {
    const match = /^#p=(.+)$/.exec(location.hash);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (featureById(id)) selectPoint(id, { fly: true, popup: true });
    }
  });
}

/* ---------------- boot ---------------- */

async function boot() {
  // export link (only shown when user points exist)
  const foot = document.querySelector('.panel-foot');
  const exportBtn = document.createElement('button');
  exportBtn.id = 'btn-export';
  exportBtn.className = 'text-btn';
  exportBtn.hidden = true;
  exportBtn.innerHTML = `${svgIcon('i-download')} ดาวน์โหลดจุดของฉัน (GeoJSON)`;
  exportBtn.addEventListener('click', exportUserPoints);
  foot.appendChild(exportBtn);

  state.userFeatures = loadUserFeatures();
  if (isMobile()) setRouteExpanded(false);

  let points;
  let district;
  try {
    [points, district] = await Promise.all([
      fetchJson(absoluteUrl(CFG.data.points)),
      fetchJson(absoluteUrl(CFG.data.district))
    ]);
  } catch (err) {
    console.error(err);
    el.loading.innerHTML = '<span>โหลดข้อมูลไม่สำเร็จ — ตรวจสอบการเชื่อมต่อ</span>';
    return;
  }

  state.districtFeature = district.features[0];
  state.features = [...points.features, ...state.userFeatures];

  renderFilters();
  renderList();
  updateExportLink();

  try {
    await initMap(district);
  } catch (err) {
    console.error(err);
    el.loading.innerHTML = '<span>โหลดแผนที่ไม่สำเร็จ — ลองรีเฟรชอีกครั้ง</span>';
    return;
  }

  initialFitDone = true;
  renderMarkers();
  wireEvents();

  const match = /^#p=(.+)$/.exec(location.hash);
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (featureById(id)) setTimeout(() => selectPoint(id, { fly: true, popup: true }), 400);
  }
}

boot();
