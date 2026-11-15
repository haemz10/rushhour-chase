import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rushhourchase.app',
  appName: '퇴근길 대추격전',
  webDir: 'www',
  backgroundColor: '#070818',
  ios: {
    contentInset: 'never',
    scrollEnabled: false,
    preferredContentMode: 'mobile',
    zoomEnabled: false,
    backgroundColor: '#070818',
  },
};

export default config;
