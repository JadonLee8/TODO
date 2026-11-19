import type { CapacitorConfig } from '@capacitor/cli'

// The Android app (see mobile/). Lives at the repo root so the Capacitor CLI finds its plugins in package.json.
const config: CapacitorConfig = {
  appId: 'com.jadonlee.todoapp',
  appName: 'TODO',
  webDir: 'mobile/dist',
  android: { path: 'mobile/android' }
}

export default config
