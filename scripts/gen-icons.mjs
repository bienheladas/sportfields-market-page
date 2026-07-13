// gen-icons.mjs — generates all Android icon & splash PNG assets from the brand SVG.
// Run once after branding changes: node scripts/gen-icons.mjs
// Requires: @resvg/resvg-js (npm install --save-dev @resvg/resvg-js)
import { Resvg } from '@resvg/resvg-js'
import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const res = join(__dirname, '..', 'android', 'app', 'src', 'main', 'res')

// ── SVG templates ──────────────────────────────────────────────────────────────

// Full icon: gradient bg + white court icon
function iconSvg(size) {
  const rx = Math.round(size * 0.22)
  const iconSz = size * 0.56
  const off = (size - iconSz) / 2
  const sc = iconSz / 48
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ff8a72"/>
      <stop offset="55%" stop-color="#ff6a4d"/>
      <stop offset="100%" stop-color="#d44a2f"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${rx}" fill="url(#g)"/>
  <g transform="translate(${off},${off}) scale(${sc})">
    <rect x="7" y="7" width="34" height="34" rx="7" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="24" y1="7" x2="24" y2="41" stroke="white" stroke-width="3" stroke-linecap="round"/>
    <circle cx="24" cy="24" r="7" fill="none" stroke="white" stroke-width="3"/>
  </g>
</svg>`
}

// Round icon: same but circular clip
function roundIconSvg(size) {
  const r = size / 2
  const iconSz = size * 0.56
  const off = (size - iconSz) / 2
  const sc = iconSz / 48
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ff8a72"/>
      <stop offset="55%" stop-color="#ff6a4d"/>
      <stop offset="100%" stop-color="#d44a2f"/>
    </linearGradient>
    <clipPath id="c"><circle cx="${r}" cy="${r}" r="${r}"/></clipPath>
  </defs>
  <g clip-path="url(#c)">
    <rect width="${size}" height="${size}" fill="url(#g)"/>
    <g transform="translate(${off},${off}) scale(${sc})">
      <rect x="7" y="7" width="34" height="34" rx="7" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="24" y1="7" x2="24" y2="41" stroke="white" stroke-width="3" stroke-linecap="round"/>
      <circle cx="24" cy="24" r="7" fill="none" stroke="white" stroke-width="3"/>
    </g>
  </g>
</svg>`
}

// Foreground layer: white icon on transparent (for adaptive icon)
// Icon is in center 55% to stay within the safe zone
function fgSvg(size) {
  const iconSz = size * 0.55
  const off = (size - iconSz) / 2
  const sc = iconSz / 48
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g transform="translate(${off},${off}) scale(${sc})">
    <rect x="7" y="7" width="34" height="34" rx="7" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="24" y1="7" x2="24" y2="41" stroke="white" stroke-width="3" stroke-linecap="round"/>
    <circle cx="24" cy="24" r="7" fill="none" stroke="white" stroke-width="3"/>
  </g>
</svg>`
}

// Splash: paper bg + centered coral icon
function splashSvg(w, h) {
  const iconSz = Math.min(w, h) * 0.22
  const off = iconSz / 2
  const sc = iconSz / 48
  const cx = w / 2
  const cy = h / 2 - iconSz * 0.15
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#f8f4ec"/>
  <g transform="translate(${cx - off},${cy - off}) scale(${sc})">
    <rect x="7" y="7" width="34" height="34" rx="7" fill="none" stroke="#ff6a4d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="24" y1="7" x2="24" y2="41" stroke="#ff6a4d" stroke-width="3" stroke-linecap="round"/>
    <circle cx="24" cy="24" r="7" fill="none" stroke="#ff6a4d" stroke-width="3"/>
  </g>
</svg>`
}

// ── Render helper ──────────────────────────────────────────────────────────────

function render(svg, outPath) {
  const resvg = new Resvg(svg)
  const png = resvg.render().asPng()
  writeFileSync(outPath, png)
  const rel = outPath.replace(res + '\\', '').replace(res + '/', '')
  console.log(`✓ ${rel}`)
}

// ── Launcher icons ─────────────────────────────────────────────────────────────

const mipmaps = [
  ['mipmap-mdpi',     48],
  ['mipmap-hdpi',     72],
  ['mipmap-xhdpi',    96],
  ['mipmap-xxhdpi',  144],
  ['mipmap-xxxhdpi', 192],
]

console.log('\n── Launcher icons ────────────────────────────')
for (const [dir, size] of mipmaps) {
  render(iconSvg(size),      join(res, dir, 'ic_launcher.png'))
  render(roundIconSvg(size), join(res, dir, 'ic_launcher_round.png'))
  render(fgSvg(size),        join(res, dir, 'ic_launcher_foreground.png'))
}

// ── Splash screens ─────────────────────────────────────────────────────────────

const splashes = [
  ['drawable-port-mdpi',     320,  480],
  ['drawable-port-hdpi',     480,  800],
  ['drawable-port-xhdpi',    720, 1280],
  ['drawable-port-xxhdpi',   960, 1600],
  ['drawable-port-xxxhdpi', 1280, 1920],
  ['drawable-land-mdpi',     480,  320],
  ['drawable-land-hdpi',     800,  480],
  ['drawable-land-xhdpi',   1280,  720],
  ['drawable-land-xxhdpi',  1600,  960],
  ['drawable-land-xxxhdpi', 1920, 1280],
]

console.log('\n── Splash screens ────────────────────────────')
for (const [dir, w, h] of splashes) {
  render(splashSvg(w, h), join(res, dir, 'splash.png'))
}

// ── Web favicon ────────────────────────────────────────────────────────────────

// 192×192 for web manifest, 32×32 for favicon
const pub = join(__dirname, '..', 'public')
console.log('\n── Web assets ────────────────────────────────')
render(iconSvg(192), join(pub, 'icon-192.png'))
render(iconSvg(32),  join(pub, 'favicon-32.png'))

console.log('\n✅ Done. Run: npx cap sync android\n')
