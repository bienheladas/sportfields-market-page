import * as React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { MeshProvider } from '@meshsdk/react'
import { Navbar } from './components/Navbar'
import FieldDiscovery from './pages/FieldDiscovery'
import FieldDetail from './pages/FieldDetail'
import OwnerPanel from './pages/OwnerPanel'
import MyBookings from './pages/MyBookings'
import RegisterOwner from './pages/RegisterOwner'

export default function App() {
  return (
    <MeshProvider>
      <BrowserRouter>
        <div className="min-h-screen bg-[var(--paper)]">
          <Navbar />
          <Routes>
            <Route path="/"                          element={<FieldDiscovery />} />
            <Route path="/field/:ownerNFT" element={<FieldDetail />} />
            <Route path="/register"                   element={<RegisterOwner />} />
            <Route path="/owner"                     element={<OwnerPanel />} />
            <Route path="/bookings"                  element={<MyBookings />} />
          </Routes>
        </div>
      </BrowserRouter>
    </MeshProvider>
  )
}
