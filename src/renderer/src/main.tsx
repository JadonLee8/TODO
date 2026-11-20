import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AppStateProvider } from './state/AppStateContext'
import { applyCachedAppearance } from './theme'
import { ConfirmProvider } from './components/ConfirmDialog'
import { Tooltips } from './components/Tooltips'
import '@fontsource-variable/bricolage-grotesque/standard.css'
import '@fontsource-variable/doto/index.css'
import '@fontsource-variable/jetbrains-mono/index.css'
import './styles/global.css'
import './styles/terminal.css'

applyCachedAppearance()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppStateProvider>
      <ConfirmProvider>
        <App />
        <Tooltips />
      </ConfirmProvider>
    </AppStateProvider>
  </React.StrictMode>
)
