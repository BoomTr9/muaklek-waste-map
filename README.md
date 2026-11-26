# มวกเหล็กไร้ขยะ — Muak Lek Waste Map

เว็บแอปแผนที่จุดทิ้งขยะ/จุดรับรีไซเคิลเฉพาะ **อำเภอมวกเหล็ก จังหวัดสระบุรี** พร้อมคำนวณเส้นทางด้วยรถยนต์ จักรยาน และการเดิน

**Live:** https://boomtr9.github.io/muaklek-waste-map/ · **Repo:** https://github.com/BoomTr9/muaklek-waste-map

- ฐานแผนที่ **Protomaps** ตัดเฉพาะพื้นที่อำเภอ (z0–15) เก็บไว้ในโปรเจกต์ ไม่ต้องพึ่ง tile server ภายนอก
- ข้อมูลจุดจากหน่วยงานรัฐ (สคพ.7 / GD Catalog สระบุรี) และ OpenStreetMap
- เส้นทางจาก Valhalla (สำรอง: OSRM) — ฟรี ไม่ใช้ API key
- เพิ่ม/ลบจุดของคุณเอง เก็บใน localStorage และส่งออก GeoJSON ได้
- หน้าเดียว ไม่มี build step ใช้ MapLibre GL 5.24.1 + Protomaps Basemap 4.15.2

## โครงสร้าง

```
site/                      # เว็บไซต์ที่ deploy (static)
  index.html
  assets/app.js            # ตัวแอปทั้งหมด (ES module)
  assets/app.css
  assets/config.js         # ตั้งค่า tile mode / endpoint
  data/waste-points.geojson
  data/district.geojson    # ขอบเขตอำเภอ (ลดรูปแล้ว)
  data/mask.geojson        # มาสก์หรี่พื้นที่นอกอำเภอ
  data/muaklek.pmtiles     # ไฟล์แผนที่ดิบ (โหมด pmtiles)
  tiles/{z}/{x}/{y}.pbf    # ไทล์จาก PMTiles (โหมด zxy, ค่าเริ่มต้น)
scripts/
  serve.mjs                # static server + Range support
  pmtiles_to_zxy.mjs       # แปลง PMTiles → z/x/y.pbf
  build_boundary.mjs       # ลดรูป polygon อำเภอ
data/
  muaklek.pmtiles          # ต้นฉบับ
  waste-sites-saraburi.csv # ข้อมูลต้นทางจาก GD Catalog
tools/pmtiles.exe          # CLI ที่ใช้ตัดไทล์ (v1.31.2)
```

## รันในเครื่อง

ต้องมี Node.js 22+

```powershell
node scripts/serve.mjs 8080
# เปิด http://localhost:8080
```

`scripts/serve.mjs` รองรับ HTTP Range ทำให้ทดสอบโหมด `pmtiles` ได้ในเครื่อง

## แก้ไขข้อมูลจุด

แก้ `site/data/waste-points.geojson` ได้โดยตรง โครงสร้าง properties:

| field | ค่า |
|---|---|
| `id` | รหัสไม่ซ้ำ |
| `name`, `address`, `hours`, `note` | ข้อความแสดงผล |
| `category` | `facility` / `recycle` / `hazard` / `dropoff` |
| `accepts` | array ของสิ่งที่รับ |
| `accuracy` | `pcd` (ข้อมูลหน่วยงานรัฐ), `osm`, `user` |
| `source_label`, `source_url` | แหล่งอ้างอิง |

เพิ่มจุดผ่านปุ่ม “เพิ่มจุด” ในแอป (เก็บเฉพาะเบราว์เซอร์ผู้ใช้) แล้วดาวน์โหลด GeoJSON เพื่อรวมเข้าไฟล์จริงได้

## แผนที่ Protomaps — วิธีสร้างใหม่

```powershell
# 1) ดึงเฉพาะ bounding box อำเภอ (ไฟล์ build รายวัน)
tools/pmtiles.exe extract "https://build.protomaps.com/20261125.pmtiles" `
  data/muaklek.pmtiles --bbox=101.06,14.46,101.47,15.06 --maxzoom=15

# 2) แปลงเป็นไทล์ static สำหรับ host ทั่วไป
node scripts/pmtiles_to_zxy.mjs data/muaklek.pmtiles site/tiles 15

# 3) อัปเดตสำเนาสำหรับโหมด pmtiles (ถ้าใช้)
Copy-Item data/muaklek.pmtiles site/data/ -Force
```

- ไทล์ที่ตัดได้: 3,055 ไฟล์, ~5.3 MB (z0–15) — ครอบคลุมอำเภอมวกเหล็กทั้งหมด
- build ที่ใช้: `20261125.pmtiles`, Protomaps Basemap v4.15.2, © OpenStreetMap contributors (ODbL)
- เลือกโหมดได้ที่ `site/assets/config.js` → `tiles.mode`: `zxy` (ค่าเริ่มต้น) หรือ `pmtiles`
  - โหมด `pmtiles` ต้องให้ host รองรับ Range requests (Cloudflare Pages/R2, S3, R2 + Worker)
  - ทดสอบโหมด pmtiles ได้ทันทีด้วย `http://localhost:8080/?tiles=pmtiles` (ไม่ต้องแก้ config)

ขอบเขตอำเภอดึงจาก OSM relation 18918368 ผ่าน Nominatim แล้วลดรูปด้วย `scripts/build_boundary.mjs`

## Deploy ฟรี

### Cloudflare Pages (แนะนำ — รองรับทุกโหมด + `_headers`)

```powershell
npx wrangler login          # เปิดเบราว์เซอร์ครั้งเดียว
npx wrangler pages deploy site --project-name muaklek-waste
```

ได้ URL `https://muaklek-waste.pages.dev` (ตั้งชื่อซ้ำได้ตามต้องการ)

### Netlify

```powershell
npx netlify-cli login
npx netlify-cli deploy --prod --dir=site
```

หรือ drag-and-drop โฟลเดอร์ `site/` ที่ https://app.netlify.com/drop

### GitHub Pages

โฟลเดอร์ `site/` ถูก deploy ผ่าน branch `gh-pages` (root) — ไม่ต้องใช้ Actions

```powershell
gh auth login
gh repo create muaklek-waste-map --public --source . --remote origin
git push -u origin main
git subtree push --prefix site origin gh-pages
# Settings → Pages → Deploy from branch: gh-pages / root
```

หรือใช้ API เปิด Pages ครั้งแรก:

```powershell
gh api --method POST repos/<owner>/muaklek-waste-map/pages `
  -f 'source[branch]=gh-pages' -f 'source[path]=/'
```

- GitHub Pages ฟรีต้องใช้ repo แบบ public
- Pages ไม่รองรับ custom headers/Range จึงใช้โหมด `zxy` (ค่าเริ่มต้น) — ไทล์ ~3,100 ไฟล์ต่ำกว่าขีดจำกัด
- URL: `https://<owner>.github.io/muaklek-waste-map/`
- อัปเดตภายหลัง: push `main` แล้ว `git subtree push --prefix site origin gh-pages` อีกครั้ง

### Cloudflare R2 + PMTiles (ไฟล์เดียว)

อัปโหลด `site/data/muaklek.pmtiles` ไป R2 แล้วเปิด public access ตั้ง `tiles.mode = 'pmtiles'` และตั้ง `tiles.pmtiles` เป็น URL ของไฟล์ (ต้องมี CORS + Range)

## ทดสอบในเครื่อง

```powershell
node scripts/serve.mjs 8080
npm install -D playwright
npx playwright install chromium
node tests/smoke.mjs          # แผนที่ + เส้นทาง + ภาพหน้าจอ desktop/mobile
node tests/interactions.mjs   # ตัวกรอง เพิ่ม/ลบจุด และกรณีไม่อนุญาตตำแหน่ง
```

ภาพผลลัพธ์อยู่ใน `tests/screens/`

## ข้อจำกัดที่ควรรู้

- **ข้อมูลจุดมี 5 จุดที่ยืนยันแหล่งที่มาแล้ว** ไม่ใช่รายการจุดทิ้งขยะครบทุกจุดในอำเภอ — OSM ในพื้นที่ยัง sparse; เพิ่มจุดได้ในแอปและควรตรวจสอบกับ อบต./เทศบาลก่อนนำเข้าข้อมูลจริง
- ขยะอันตราย: อบต.มวกเหล็ก รับที่สำนักงาน (234 ม.2 ต.มวกเหล็ก โทร. 036-909-352) จึงยังไม่ปักหมุดบนแผนที่เพื่อเลี่ยงพิกัดคลาดเคลื่อน
- เส้นทางใช้เซิร์ฟเวอร์สาธารณะ Valhalla/OSRM (ไม่มี SLA) ระยะเวลาเป็นค่าประมาณจากความเร็วถนน ไม่ใช่สภาพจราจรจริง
- ในกรณีที่ทั้งสองบริการล่ม แอปจะแสดงเส้นตรงพร้อมป้าย “ประมาณการ” และลิงก์ Google Maps

## แหล่งข้อมูล

- [ข้อมูลสถานที่กำจัดขยะมูลฝอย จังหวัดสระบุรี (GD Catalog)](https://saraburi.gdcatalog.go.th/dataset/cb262063-bfc5-47b8-89b3-3af6f52a95bc) — สำนักงานสิ่งแวดล้อมและควบคุมมลพิษที่ 7
- [OpenStreetMap](https://www.openstreetmap.org/copyright) — ข้อมูลแผนที่และตำแหน่งบางจุด (ODbL)
- [Protomaps](https://protomaps.com) — basemap tiles/builds
- [Valhalla](https://github.com/valhalla/valhalla) / [OSRM](https://project-osrm.org) — routing

ซอร์สโค้ดในโปรเจกต์นี้ใช้ได้อย่างอิสระ ข้อมูลแผนที่อยู่ภายใต้ ODbL ของ OpenStreetMap
