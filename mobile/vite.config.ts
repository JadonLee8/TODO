import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Builds the Android app's web bundle (the desktop renderer plus an Android `window.api`) into mobile/dist,
// which Capacitor copies into the native project (see capacitor.config.ts).
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, '../src/renderer/src'),
      '@shared': resolve(__dirname, '../src/shared')
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    // main.ts uses top-level await; the Android System WebView is a current Chromium.
    target: 'es2022'
  }
})
