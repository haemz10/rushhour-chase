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
  plugins: {
    // Capacitor 8 내장 SystemBars: 시작 시 상태바 + 홈 인디케이터 숨김
    // (기본값 hidden:false는 Info.plist의 UIStatusBarHidden을 다시 보이게 덮어쓰므로 반드시 지정)
    SystemBars: {
      hidden: true,
      style: 'DARK',
    },
  },
};

export default config;
