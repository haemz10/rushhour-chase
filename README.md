# 퇴근길 대추격전 (Rush Hour Chase) 🏃‍♀️💨

> 밤 11시 30분, 야근을 마친 회사원 **수진**. 막차 지하철의 기분 좋은 흔들림에 깜빡 잠든 사이 —
> **가방과 휴대폰이 사라졌다!** 도둑을 쫓아 도시의 밤을 달리는 추격 러너 액션 게임.

게임 자체는 의존성 0개, 순수 HTML5 Canvas + Web Audio로 만든 모바일 우선 게임입니다.
가로/세로 모드 모두 지원하며 오프라인(PWA)에서도 동작합니다.

**🌐 6개 언어 지원** — 한국어 · English · 日本語 · 简体中文 · Español · Français.
첫 실행 시 언어 선택 화면이 나오며(기기 언어 자동 감지), 메뉴의 🌐 버튼으로 언제든 변경할 수 있습니다.
모든 UI·컷씬 자막·게임 내 메시지가 번역되어 있고 문자열은 `i18n.js` 한 파일에서 관리됩니다.

## 게임 구성

1. **스토리 컷씬** — 퇴근길 → 지하철에서 꾸벅꾸벅 → 화들짝! 사라진 가방 → 추격 시작 (탭으로 넘기기 / 건너뛰기 가능)
2. **추격 러너** — 자동으로 달리는 수진을 조작해 장애물을 넘고 부수며 도둑을 쫓는다
3. **도둑 잡기** — 도둑 패거리가 번갈아 나타나 훔친 📱휴대폰 → 👛지갑 → 👜가방을 들고 도망친다.
   따라잡아 펀치로 잡으면 물건 회수! 3개를 모두 되찾으면 **스테이지 클리어** (배경 테마 변경 + 보너스)
4. **게임오버 → 상점 → 재도전** 의 중독성 루프

## 조작 (한 손 플레이 가능)

| 입력 | 동작 |
|---|---|
| 화면 왼쪽 탭 | 점프 (공중에서 한 번 더 = 더블점프/날기) |
| 화면 오른쪽 탭 | 펀치 (장애물 부수기 · 비둘기 쫓기 · **도둑 잡기**) |
| 키보드 | Space/↑ 점프, F/X 펀치, P 일시정지 |

## 주요 시스템

- **장애물**: 콘·바리케이드(점프), 택배 상자탑(펀치 또는 더블점프), 비둘기 떼(밑으로 통과하거나 펀치)
- **파워업**: 🧲 자석(코인 자동 흡수) · 🛡️ 방패(1회 피격 방어) · ⚡ 폭주 대시(무적+가속) · ❤️ 체력 회복
- **콤보 시스템**: 코인/처치가 이어지면 콤보 상승, 10콤보마다 코인 배수 증가 (피격 시 리셋)
- **업그레이드 상점**: 모은 코인으로 러닝화(시작 속도), 자석/방패 지속시간, 최대 체력 영구 강화
- **난이도 곡선**: 시간이 지날수록 속도·패턴 난이도 상승, 스테이지마다 배경 테마 순환
  (지하철 승강장 → 도심 네온거리 → 새벽 한강공원)
- **사운드**: Web Audio 실시간 합성 8비트풍 BGM + 효과음, 🎵 버튼으로 오리지널 BGM(`bgm1~3.m4a`) 전환, 햅틱 피드백
- **저장**: 최고 점수·코인·업그레이드는 `localStorage`에 자동 저장

## 실행 방법

```bash
npx serve .        # 또는 python3 -m http.server 8080
# 브라우저에서 http://localhost:3000 (모바일 확인은 개발자도구 기기 모드)
```

파일을 그냥 브라우저로 열어도(`index.html` 더블클릭) 플레이됩니다. (서비스워커만 비활성)

## iOS 앱 (Capacitor 8, iPhone 전용)

루트의 웹 파일은 GitHub Pages용으로 그대로 두고, 앱에 필요한 에셋만 `www/`로 복사해 네이티브 앱을 만듭니다.

```bash
npm install                 # Capacitor 8 + Haptics/Browser 플러그인
npm run build:native        # 루트 → www/ (index·game·i18n·bgm1~3.m4a·정책/지원 페이지)
npx cap sync ios            # www/ → ios/App/App/public, SPM 플러그인 갱신
npx cap open ios            # Xcode에서 Signing Team 선택 → Product › Archive → App Store Connect 업로드
```

| 항목 | 설정 |
|---|---|
| Bundle ID / 이름 | `com.rushhourchase.app` / 퇴근길 대추격전 |
| 기기 | iPhone 전용 (`TARGETED_DEVICE_FAMILY = 1`) |
| 화면 방향 | 세로 · 가로(좌/우), 상하반전 제외 |
| 상태바 | 숨김 (`UIStatusBarHidden`), 홈 인디케이터 자동 숨김 |
| 수출 규정 | `ITSAppUsesNonExemptEncryption = false` |
| 사운드 | `AVAudioSession` `.playback` + `navigator.audioSession.type = 'playback'` → 무음 스위치에서도 재생 |
| 진동 | `@capacitor/haptics` (웹에서는 `navigator.vibrate` fallback) |
| 앱 아이콘 | `icon.svg` → 1024×1024 불투명 PNG (`node scripts/generate-app-icon.mjs`) |
| 런치 스크린 | `#070818` 단색 |

앱 메뉴 하단의 **ⓘ** 버튼에서 [개인정보처리방침](privacypolicy.html)과 [지원 페이지](support.html)를 열 수 있습니다
(앱에서는 인앱 Safari 시트, 웹에서는 새 탭). 문의: `cloviradmin@gmail.com`

### 광고

현재 버전에는 광고 SDK가 **포함되어 있지 않으며** 개인정보를 수집하지 않습니다
(App Store Connect 개인정보 라벨: "데이터를 수집하지 않음").
게임 코드에는 `window.AdBridge`(`isRewardedReady()`, `showRewarded(onReward)`)가 주입될 때만 나타나는
"광고 보고 부활" 연동 지점이 남아 있으므로, 향후 광고를 도입한다면 개인정보처리방침·개인정보 라벨·ATT 처리를 함께 갱신해야 합니다.

## 파일 구조

```
rushhour-chase/
├── index.html           # 엔트리 (뷰포트/PWA 메타)
├── game.js              # 게임 전체 로직 (컷씬·러너·상점·사운드·네이티브 브리지)
├── i18n.js              # 6개 언어 문자열 (ko/en/ja/zh/es/fr)
├── bgm1~3.m4a           # 오리지널 BGM (AAC)
├── privacypolicy.html   # 개인정보처리방침 (한/영)
├── support.html         # 지원 페이지 (한/영)
├── manifest.json        # PWA 매니페스트
├── sw.js                # 오프라인 캐시 서비스워커 (웹 전용)
├── icon.svg             # 앱 아이콘 원본
├── capacitor.config.ts  # Capacitor 설정
├── scripts/             # build-native.mjs, generate-app-icon.mjs
└── ios/                 # Xcode 프로젝트 (Capacitor 8, SPM)
```
