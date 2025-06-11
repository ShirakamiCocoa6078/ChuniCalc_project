
export const translations = {
  KR: {
    homePageTitle: "ChuniCalc",
    languageToggleKR: "KR (한국어)",
    languageToggleJP: "JP (日本語)",
    // ChuniCalcForm
    formTitle: "ChuniCalc",
    formDescription: "츄니즘 성장 시뮬레이터. 닉네임으로 레이팅을 조회하거나 직접 입력하세요.",
    nicknameLabel: "닉네임 (Chunirec User Name)",
    nicknamePlaceholder: "예: chunirec",
    fetchRatingButton: "조회",
    nicknameHelp: "Chunirec 닉네임을 입력하여 현재 레이팅을 조회합니다.",
    currentRatingLabel: "현재 레이팅",
    currentRatingPlaceholder: "Chunirec 유저명을 입력해 조회하세요",
    currentRatingHelp: "Chunirec 유저명을 입력해 조회하세요.", // 이 부분은 ChuniCalcForm.tsx에서 더 이상 사용되지 않습니다.
    targetRatingLabel: "목표 레이팅",
    targetRatingPlaceholder: "예: 16.00",
    targetRatingHelp: "목표 레이팅을 입력하세요. (최대 17.50)",
    calculateButton: "계산 및 결과 보기",
    // AdvancedSettings
    advancedSettingsTitle: "고급 설정 및 데이터 관리",
    advancedSettingsDescription: "로컬 API 키 설정, 캐시 데이터 관리, 개발자 모드 등 고급 기능을 사용합니다.",
    localApiKeyLabel: "로컬 API 키 설정",
    localApiKeyPlaceholder: "개인 Chunirec API 토큰 입력",
    saveApiKeyButton: "로컬 API 키 저장/업데이트",
    localApiKeyHelp: "여기에 개인 Chunirec API 토큰을 입력하면, 앱 실행 시 우선적으로 이 키를 사용합니다. 비워두고 저장하면 제거됩니다.",
    developerModeLabel: "개발자 모드",
    goToApiTestPageButton: "API 테스트 페이지로 이동",
    manualCachingLabel: "수동 데이터 캐싱",
    cacheGlobalMusicButton: "전역 음악 목록 캐시 (music/showall)",
    cacheUserNicknameLabel: "캐시할 사용자 닉네임",
    cacheUserNicknamePlaceholder: "Chunirec 닉네임",
    cacheUserRecordsButton: "해당 사용자 기록 캐시 (records/showall)",
    clearLocalDataButton: "모든 로컬 캐시 데이터 삭제",
    clearLocalDataHelp: "앱이 로컬 저장소에 저장한 모든 캐시 데이터 (UI 데이터, API 응답, 로컬 API 토큰, 개발자 모드 설정 제외)를 삭제합니다.",
    contactInfoLabel: "문의 및 정보",
    contactInfoBugReport: "버그 리포트 및 기타 문의:",
    appVersion: "ChuniCalc v1.0.0",
    adminPanelToggleShow: "관리자 패널 표시",
    adminPanelToggleHide: "관리자 패널 숨기기"
  },
  JP: {
    homePageTitle: "チュニカルク",
    languageToggleKR: "KR (韓国語)",
    languageToggleJP: "JP (日本語)",
    // ChuniCalcForm
    formTitle: "チュニカルク",
    formDescription: "チュウニズム成長シミュレーター。ニックネームでレーティングを照会するか、直接入力してください。",
    nicknameLabel: "ニックネーム (Chunirec User Name)",
    nicknamePlaceholder: "例: chunirec",
    fetchRatingButton: "照会",
    nicknameHelp: "Chunirecのニックネームを入力して現在のレーティングを照会します。",
    currentRatingLabel: "現在レーティング",
    currentRatingPlaceholder: "Chunirecユーザー名を入力して照会してください",
    currentRatingHelp: "Chunirecユーザー名を入力して照会してください。", // 이 부분은 ChuniCalcForm.tsx에서 더 이상 사용되지 않습니다.
    targetRatingLabel: "目標レーティング",
    targetRatingPlaceholder: "例: 16.00",
    targetRatingHelp: "目標レーティングを入力してください。(最大 17.50)",
    calculateButton: "計算および結果表示",
    // AdvancedSettings
    advancedSettingsTitle: "高度な設定とデータ管理",
    advancedSettingsDescription: "ローカルAPIキーの設定、キャッシュデータの管理、開発者モードなどの高度な機能を使用します。",
    localApiKeyLabel: "ローカルAPIキー設定",
    localApiKeyPlaceholder: "個人用 Chunirec API トークン入力",
    saveApiKeyButton: "ローカルAPIキー保存/更新",
    localApiKeyHelp: "ここに個人用Chunirec APIトークンを入力すると、アプリ実行時に優先的にこのキーを使用します。空にして保存すると削除されます。",
    developerModeLabel: "開発者モード",
    goToApiTestPageButton: "APIテストページへ移動",
    manualCachingLabel: "手動データキャッシング",
    cacheGlobalMusicButton: "グローバル曲リストキャッシュ (music/showall)",
    cacheUserNicknameLabel: "キャッシュするユーザーニックネーム",
    cacheUserNicknamePlaceholder: "Chunirec ニックネーム",
    cacheUserRecordsButton: "該当ユーザー記録キャッシュ (records/showall)",
    clearLocalDataButton: "全てのローカルキャッシュデータ削除",
    clearLocalDataHelp: "アプリがローカルストレージに保存した全てのキャッシュデータ（UIデータ、API応答、ローカルAPIトークン、開発者モード設定を除く）を削除します。",
    contactInfoLabel: "お問い合わせと情報",
    contactInfoBugReport: "バグレポートおよびその他のお問い合わせ:",
    appVersion: "チュニカルク v1.0.0",
    adminPanelToggleShow: "管理者パネル表示",
    adminPanelToggleHide: "管理者パネル非表示"
  }
};

export type Locale = keyof typeof translations;
export type TranslationKey = keyof typeof translations['KR']; // Assuming KR has all keys, or define a common type

export function getTranslation(locale: Locale, key: TranslationKey): string {
  // Fallback to KR if a key is missing in the current locale, or if locale itself is somehow invalid
  const selectedLocaleTranslations = translations[locale] || translations.KR;
  const translation = selectedLocaleTranslations[key];
  
  // Fallback to KR specifically for the given key if it's missing in the selected locale's translations
  return translation === undefined ? translations.KR[key] : translation;
}
