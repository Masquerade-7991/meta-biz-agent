import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import './styles/index.css'
import { initTheme } from './app/lib/theme'
import { initDensity } from './app/lib/density'

initTheme()
initDensity()

// After a deploy, an open tab can ask for page code that no longer exists: reload once to get the
// new version (the error boundary explains it if a reload doesn't help).
window.addEventListener('vite:preloadError', (e) => {
  try {
    if (sessionStorage.getItem('helo:reloaded-for-update')) return
    sessionStorage.setItem('helo:reloaded-for-update', '1')
  } catch {
    return
  }
  e.preventDefault()
  window.location.reload()
})
window.addEventListener('load', () => {
  try {
    setTimeout(() => sessionStorage.removeItem('helo:reloaded-for-update'), 10_000)
  } catch {
    /* storage blocked */
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
