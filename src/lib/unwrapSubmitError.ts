// Blockfrost TxSubmitFail nests the real ledger error several JSON levels deep:
// ProviderError.detail → JSON → .message → JSON → .contents → ledger error
export function unwrapSubmitError(e: unknown): string {
  if (!(e instanceof Error)) return String(e)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const detail = (e as any).detail
  if (typeof detail === 'string') {
    try {
      const outer = JSON.parse(detail)
      const inner = typeof outer.message === 'string'
        ? JSON.parse(outer.message)
        : outer
      if (inner.contents !== undefined) {
        const contents = JSON.stringify(inner.contents, null, 2)
        console.error('[tx] TxSubmitFail contents:', contents)
        return `TxSubmitFail: ${contents}`
      }
    } catch { /* ignore parse errors */ }
  }
  console.error('[tx] raw error:', e)
  return e.message
}
