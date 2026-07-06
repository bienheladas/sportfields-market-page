import * as React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { LucidProvider } from './lib/LucidContext'
import { Navbar } from './components/Navbar'
import { isNativeApp } from './lib/appPlatform'

// Q0 (code-splitting): cada página se carga con React.lazy — los hooks de
// transacción (que arrastran Lucid/CML/WASM) quedan fuera del bundle inicial.
const MobileApp      = React.lazy(() => import('./mobile/MobileApp').then(m => ({ default: m.MobileApp })))
const FieldDiscovery = React.lazy(() => import('./pages/FieldDiscovery'))
const FieldDetail    = React.lazy(() => import('./pages/FieldDetail'))
const OwnerPanel     = React.lazy(() => import('./pages/OwnerPanel'))
const MyBookings     = React.lazy(() => import('./pages/MyBookings'))
const RegisterOwner  = React.lazy(() => import('./pages/RegisterOwner'))
const CompanyPanel   = React.lazy(() => import('./pages/CompanyPanel'))

function LoadingFallback() {
  return (
    <div className="min-h-[60vh] grid place-items-center">
      <span className="text-[14px] text-[var(--muted)]">Cargando…</span>
    </div>
  )
}

export default function App() {
  // Mejora Q: dentro de la app nativa (o con ?app=1 en dev) se monta el shell móvil
  // con la wallet embebida; la web sigue idéntica con CIP-30.
  if (isNativeApp()) {
    return (
      <LucidProvider>
        <React.Suspense fallback={<LoadingFallback />}>
          <MobileApp />
        </React.Suspense>
      </LucidProvider>
    )
  }

  return (
    <LucidProvider>
      <BrowserRouter>
        <div className="min-h-screen bg-[var(--paper)]">
          <Navbar />
          <React.Suspense fallback={<LoadingFallback />}>
            <Routes>
              <Route path="/"                element={<FieldDiscovery />} />
              <Route path="/field/:ownerNFT" element={<FieldDetail />} />
              <Route path="/register"        element={<RegisterOwner />} />
              <Route path="/owner"           element={<OwnerPanel />} />
              <Route path="/bookings"        element={<MyBookings />} />
              <Route path="/company"         element={<CompanyPanel />} />
            </Routes>
          </React.Suspense>
        </div>
      </BrowserRouter>
    </LucidProvider>
  )
}
