import { resolve } from 'path'
import { defineConfig } from 'vite'

// Builds the Manifest V3 extension into extension/dist (load it unpacked from chrome://extensions).
export default defineConfig({
  root: __dirname,
  publicDir: resolve(__dirname, 'public'),
  base: './',
  resolve: {
    alias: { '@shared': resolve(__dirname, '../src/shared') }
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    // Extension pages can't load inline scripts (MV3 CSP), and there's nothing to preload over the network.
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        options: resolve(__dirname, 'options.html'),
        sidepanel: resolve(__dirname, 'sidepanel.html'),
        background: resolve(__dirname, 'src/background/index.ts')
      },
      output: {
        // The manifest refers to the service worker by a fixed name.
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js')
      }
    }
  }
})
