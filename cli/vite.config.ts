import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vite'

const { version } = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as { version: string }

// Bundles the `todo` CLI (cli/src/main.ts plus the shared sync and command code) into one Node file with no
// dependencies: cli/dist/todo.mjs. `npm install -g ./cli` puts `todo` on the PATH.
export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../src/shared')
    }
  },
  define: {
    __TODO_VERSION__: JSON.stringify(version)
  },
  build: {
    ssr: resolve(__dirname, 'src/main.ts'),
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: {
      output: {
        format: 'es',
        entryFileNames: 'todo.mjs',
        banner: '#!/usr/bin/env node'
      }
    }
  }
})
