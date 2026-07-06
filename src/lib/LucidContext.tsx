import * as React from 'react'
import { getLucid } from './lucid'

type LucidInstance = Awaited<ReturnType<typeof getLucid>>

interface LucidContextValue {
  lucid: LucidInstance | null
  connected: boolean
  address: string
  pkh: string
  walletName: string
  connectWallet: (walletName: string) => Promise<void>
  connectWithSeed: (seed: string) => Promise<void>
  disconnect: () => void
}

const LucidContext = React.createContext<LucidContextValue | null>(null)

export function LucidProvider({ children }: { children: React.ReactNode }) {
  const [lucid, setLucid] = React.useState<LucidInstance | null>(null)
  const [connected, setConnected] = React.useState(false)
  const [address, setAddress] = React.useState('')
  const [pkh, setPkh] = React.useState('')
  const [walletName, setWalletName] = React.useState('')

  const connectWallet = React.useCallback(async (name: string) => {
    const api = await (window as any).cardano[name].enable()
    const l = await getLucid()
    // Q0: getAddressDetails viene del paquete pesado — import dinámico (ya cargado
    // de todas formas por getLucid, así que no cuesta una descarga extra).
    const { getAddressDetails } = await import('@lucid-evolution/lucid')
    l.selectWallet.fromAPI(api)
    const addr = await l.wallet().address()
    const details = getAddressDetails(addr)
    const paymentHash = details.paymentCredential?.hash ?? ''
    setLucid(l)
    setConnected(true)
    setAddress(addr)
    setPkh(paymentHash)
    setWalletName(name)
  }, [])

  // Mejora Q: wallet embebida — misma sesión que CIP-30 pero firmando con la seed local.
  // Deriva la cuenta 0 (m/1852'/1815'/0'/0/0), la misma que Lace por defecto.
  const connectWithSeed = React.useCallback(async (seed: string) => {
    const l = await getLucid()
    const { getAddressDetails } = await import('@lucid-evolution/lucid')
    l.selectWallet.fromSeed(seed)
    const addr = await l.wallet().address()
    const details = getAddressDetails(addr)
    const paymentHash = details.paymentCredential?.hash ?? ''
    setLucid(l)
    setConnected(true)
    setAddress(addr)
    setPkh(paymentHash)
    setWalletName('embedded')
  }, [])

  const disconnect = React.useCallback(() => {
    setConnected(false)
    setAddress('')
    setPkh('')
    setWalletName('')
    // Keep lucid instance but it no longer has a wallet selected
  }, [])

  const value: LucidContextValue = {
    lucid,
    connected,
    address,
    pkh,
    walletName,
    connectWallet,
    connectWithSeed,
    disconnect,
  }

  return (
    <LucidContext.Provider value={value}>
      {children}
    </LucidContext.Provider>
  )
}

export function useLucid(): LucidContextValue {
  const ctx = React.useContext(LucidContext)
  if (!ctx) throw new Error('useLucid must be used inside LucidProvider')
  return ctx
}
