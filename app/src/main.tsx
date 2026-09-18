import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@ui/fonts'
import '@ui/tokens.css'
import '@ui/primitives/primitives.css'
import '@ui/frame/frame.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
