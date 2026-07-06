// appPlatform.ts — Mejora Q: distingue la app nativa (Capacitor) del browser.
// No importa @capacitor/core: lee el global que Capacitor inyecta en runtime,
// así el bundle web no carga nada de Capacitor.

export function isNativeApp(): boolean {
  const cap = (window as any).Capacitor
  if (cap?.isNativePlatform?.()) return true
  // Modo de desarrollo: simular la app en browser con ?app=1
  return new URLSearchParams(window.location.search).has('app')
}
