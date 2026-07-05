// CIP-25 metadata for the Rent NFT — must be attached in the transaction that
// actually mints the token (CIP-25 metadata attached to a non-minting tx is
// not indexed by wallets/explorers, which is why this used to show up in Lace
// with no image and a raw, unintelligible asset name).

// Cardano tx metadata caps each string chunk at 64 UTF-8 *bytes*, not JS string
// length (UTF-16 code units) — a chunk of 64 *characters* containing accented
// letters (á, é, í, ó, ú, ñ — 2 bytes each in UTF-8) can silently encode to 65+
// bytes and fail with "Deserialization: 65 not at most 64". Chunk by byte
// length instead, backing off so a multi-byte character is never split in half.
export function metaStr(s: string): string | string[] {
  const bytes = new TextEncoder().encode(s)
  if (bytes.length <= 64) return s
  const chunks: string[] = []
  let start = 0
  while (start < bytes.length) {
    let end = Math.min(start + 64, bytes.length)
    while (end > start && (bytes[end] & 0xc0) === 0x80) end--
    chunks.push(new TextDecoder().decode(bytes.slice(start, end)))
    start = end
  }
  return chunks
}

export function makeRentNftImage(): string[] {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="96" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0%" stop-color="#f59e0b"/>` +
    `<stop offset="100%" stop-color="#92400e"/>` +
    `</linearGradient></defs>` +
    `<rect width="96" height="96" rx="10" fill="url(#g)"/>` +
    `<rect x="8" y="16" width="80" height="64" rx="2" stroke="rgba(255,255,255,.5)" stroke-width="1.5" fill="none"/>` +
    `<line x1="48" y1="16" x2="48" y2="80" stroke="rgba(255,255,255,.5)" stroke-width="1.5"/>` +
    `<circle cx="48" cy="48" r="12" stroke="rgba(255,255,255,.5)" stroke-width="1.5" fill="none"/>` +
    `<circle cx="48" cy="48" r="2" fill="rgba(255,255,255,.7)"/>` +
    `<rect x="8" y="33" width="14" height="30" stroke="rgba(255,255,255,.35)" stroke-width="1" fill="none"/>` +
    `<rect x="74" y="33" width="14" height="30" stroke="rgba(255,255,255,.35)" stroke-width="1" fill="none"/>` +
    `</svg>`
  const dataUri = `data:image/svg+xml;base64,${btoa(svg)}`
  const chunks: string[] = []
  for (let i = 0; i < dataUri.length; i += 64) chunks.push(dataUri.slice(i, i + 64))
  return chunks
}

export function rentNftMetadata721(rentNftPolicy: string, rentNftName: string, fieldNameText: string) {
  return {
    [rentNftPolicy]: {
      [rentNftName]: {
        name: metaStr(`${fieldNameText} — Comprobante`),
        description: metaStr(`Token de lealtad por reserva en "${fieldNameText}". Sportfields.`),
        image: makeRentNftImage(),
      },
    },
  }
}
