// CIP-25 inline SVG images for Owner NFT (red) and Rent NFT (yellow).
// Encoded as base64 data URIs, split into ≤64-char chunks per CIP-25 spec.

function makeSvg(topColor: string, botColor: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="96" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0%" stop-color="${topColor}"/>` +
    `<stop offset="100%" stop-color="${botColor}"/>` +
    `</linearGradient></defs>` +
    `<rect width="96" height="96" rx="10" fill="url(#g)"/>` +
    `<rect x="8" y="16" width="80" height="64" rx="2" stroke="rgba(255,255,255,.5)" stroke-width="1.5" fill="none"/>` +
    `<line x1="48" y1="16" x2="48" y2="80" stroke="rgba(255,255,255,.5)" stroke-width="1.5"/>` +
    `<circle cx="48" cy="48" r="12" stroke="rgba(255,255,255,.5)" stroke-width="1.5" fill="none"/>` +
    `<circle cx="48" cy="48" r="2" fill="rgba(255,255,255,.7)"/>` +
    `<rect x="8" y="33" width="14" height="30" stroke="rgba(255,255,255,.35)" stroke-width="1" fill="none"/>` +
    `<rect x="74" y="33" width="14" height="30" stroke="rgba(255,255,255,.35)" stroke-width="1" fill="none"/>` +
    `</svg>`
  )
}

function toImageChunks(svg: string): string[] {
  const dataUri = `data:image/svg+xml;base64,${btoa(svg)}`
  const chunks: string[] = []
  for (let i = 0; i < dataUri.length; i += 64) chunks.push(dataUri.slice(i, i + 64))
  return chunks
}

// Owner NFT — red (authority / ownership)
export const OWNER_NFT_IMAGE = toImageChunks(makeSvg('#ef4444', '#7f1d1d'))

// Rent NFT — yellow/amber (loyalty / receipt)
export const RENT_NFT_IMAGE  = toImageChunks(makeSvg('#f59e0b', '#92400e'))
