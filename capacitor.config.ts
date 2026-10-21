import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'jo.taqneen.taximeter',
  appName: 'عداد التاكسي',
  webDir: 'dist/taxi-meter-app/browser',
  backgroundColor: '#111827',
  android: { allowMixedContent: false }
};

export default config;
