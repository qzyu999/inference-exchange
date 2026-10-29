import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import { AuthProvider } from './lib/auth'
import { Layout } from './components/Layout'
import { Overview } from './pages/Overview'
import { Landing } from './pages/Landing'
import { Exchange } from './pages/Exchange'
import { Chat } from './pages/Chat'
import { Models } from './pages/Models'
import { Providers } from './pages/Providers'
import { Provide } from './pages/Provide'
import { Billing } from './pages/Billing'
import { Keys } from './pages/Keys'
import { Login } from './pages/Login'
import { Admin } from './pages/Admin'
import { Settings } from './pages/Settings'
import { Trace } from './pages/Trace'
import { ProviderDashboard } from './pages/ProviderDashboard'
import { Docs } from './pages/Docs'
import { NotFound } from './pages/NotFound'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Landing />} />
            <Route path="/overview" element={<Overview />} />
            <Route path="/exchange" element={<Exchange />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/models" element={<Models />} />
            <Route path="/providers" element={<Providers />} />
            <Route path="/provide" element={<Provide />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/keys" element={<Keys />} />
            <Route path="/login" element={<Login />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/trace" element={<Trace />} />
            <Route path="/docs/*" element={<Docs />} />
            <Route path="/dashboard" element={<ProviderDashboard />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
