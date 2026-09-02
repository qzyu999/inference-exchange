import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import { AuthProvider } from './lib/auth'
import { Layout } from './components/Layout'
import { Landing } from './pages/Landing'
import { Exchange } from './pages/Exchange'
import { Chat } from './pages/Chat'
import { Models } from './pages/Models'
import { Providers } from './pages/Providers'
import { Billing } from './pages/Billing'
import { Keys } from './pages/Keys'
import { Login } from './pages/Login'
import { Admin } from './pages/Admin'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Landing />} />
            <Route path="/exchange" element={<Exchange />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/models" element={<Models />} />
            <Route path="/providers" element={<Providers />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/keys" element={<Keys />} />
            <Route path="/login" element={<Login />} />
            <Route path="/admin" element={<Admin />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
