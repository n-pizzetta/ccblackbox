import "./utils/legacyStorage";
// Fonts are bundled (no request to Google Fonts): the dashboard makes no network calls.
import "@fontsource-variable/inter-tight";
import "@fontsource-variable/jetbrains-mono";
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
