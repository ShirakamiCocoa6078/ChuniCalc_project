
export const translations = {
  KR: {
    homePageTitle: "ChuniCalc",
    languageToggleKR: "KR (한국어)",
    languageToggleJP: "JP (日本語)",
    // ChuniCalcForm
    formTitle: "ChuniCalc",
    formDescription: "츄니즘 성장 시뮬레이터.",
    nicknameLabel: "닉네임 (Chunirec User Name)",
    nicknamePlaceholder: "예: chunirec",
    fetchRatingButton: "조회",
    nicknameHelp: "Chunirec 닉네임을 입력하여 현재 레이팅을 조회합니다.",
    currentRatingLabel: "현재 레이팅",
    currentRatingPlaceholder: "Chunirec 유저명을 입력해 조회하세요",
    targetRatingLabel: "목표 레이팅",
    targetRatingPlaceholder: "예: 16.00",
    targetRatingHelp: "목표 레이팅을 입력하세요. (최대 17.50)",
    calculateButton: "계산 및 결과 보기",
    // AdvancedSettings
    advancedSettingsTitle: "고급 설정 및 데이터 관리",
    advancedSettingsDescription: "로컬 API 키 설정 등 고급 기능을 사용합니다.",
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
    adminPanelToggleHide: "관리자 패널 숨기기",
    // Toast Messages KR
    toastErrorApiKeyNotSet: "API 설정 오류",
    toastErrorApiKeyNotSetDesc: "Chunirec API 토큰이 설정되지 않았습니다. 고급 설정에서 로컬 토큰을 입력하거나 환경 변수를 확인해주세요.",
    toastErrorNicknameNeeded: "닉네임 필요",
    toastErrorNicknameNeededDesc: "닉네임을 입력해야 레이팅을 조회할 수 있습니다.",
    toastErrorApiKeyMissing: "API 토큰 없음",
    toastErrorApiKeyMissingDesc: "API 토큰이 설정되지 않아 레이팅을 조회할 수 없습니다. 고급 설정 또는 환경 변수를 확인해주세요.",
    toastErrorUserNotFound: "사용자 없음",
    toastErrorUserNotFoundDesc: (nickname: string) => `닉네임 '${nickname}'에 해당하는 사용자를 찾을 수 없거나 플레이 데이터가 없습니다.`,
    toastErrorAccessDenied: "접근 금지",
    toastErrorAccessDeniedDesc: (nickname: string, code?: number) => code ? `사용자 '${nickname}'의 데이터에 접근할 권한이 없습니다. (오류 코드: ${code})` : "비공개 사용자이거나 친구가 아니어서 접근할 수 없습니다.",
    toastErrorApiRequestFailed: "API 요청 실패",
    toastErrorApiRequestFailedDesc: (status: number, message?: string) => `API 요청 실패 (상태: ${status})${message ? `: ${message}` : ''}`,
    toastSuccessRatingFetched: "레이팅 조회 성공!",
    toastSuccessRatingFetchedDesc: (playerName: string, rating: string) => `'${playerName}'님의 현재 레이팅: ${rating}`,
    toastErrorInvalidRatingData: "데이터 오류",
    toastErrorInvalidRatingDataDesc: "레이팅 정보를 가져왔으나 형식이 올바르지 않거나, 플레이 데이터가 없습니다.",
    toastErrorRatingFetchFailed: "조회 실패",
    toastErrorRatingFetchFailedDesc: (errorMsg: string) => `레이팅을 가져오는 중 오류가 발생했습니다: ${errorMsg}`,
    toastErrorMissingInfo: "정보 부족",
    toastErrorMissingInfoDesc: "현재 레이팅(조회 필요)과 목표 레이팅을 모두 입력해주세요.",
    toastErrorInvalidInput: "잘못된 입력",
    toastErrorInvalidInputDesc: "레이팅은 숫자로 입력해야 합니다.",
    toastErrorInvalidRatingRange: "잘못된 레이팅 범위",
    toastErrorInvalidRatingRangeDesc: "현재 레이팅은 0.00-17.49, 목표 레이팅은 0.00-17.50 사이여야 합니다.",
    toastErrorTargetRating: "목표 레이팅 오류",
    toastErrorTargetRatingDesc: "목표 레이팅은 현재 레이팅보다 높아야 합니다.",
    toastErrorCurrentRatingTooHigh: "현재 레이팅 너무 높음",
    toastErrorCurrentRatingTooHighDesc: "현재 레이팅이 17.50 이상입니다. 이 계산기에서는 더 이상 성장을 예측할 수 없습니다.",
    toastSuccessLocalApiKeySaved: "로컬 API 키 저장됨",
    toastSuccessLocalApiKeySavedDesc: "입력한 API 키가 로컬 저장소에 저장되었습니다.",
    toastSuccessLocalApiKeyRemoved: "로컬 API 키 제거됨",
    toastSuccessLocalApiKeyRemovedDesc: "로컬 API 키가 비어있어 저장소에서 제거되었습니다.",
    toastSuccessLocalDataCleared: "로컬 데이터 삭제 완료",
    toastSuccessLocalDataClearedDesc: (count: number) => `${count}개의 앱 관련 로컬 캐시 데이터가 삭제되었습니다.`,
    toastInfoCachingStarted: "캐싱 시작",
    toastInfoCachingStartedDesc: (target: string) => `${target}을(를) 가져오고 있습니다...`,
    toastSuccessGlobalMusicCached: "캐싱 성공",
    toastSuccessGlobalMusicCachedDesc: "전역 음악 목록이 로컬 저장소에 캐시되었습니다.",
    toastErrorGlobalMusicCacheFailed: "캐싱 실패",
    toastErrorGlobalMusicCacheFailedDesc: (errorMsg?: string) => errorMsg ? errorMsg : "전역 음악 목록 캐싱 중 오류 발생.",
    toastSuccessUserRecordsCached: "캐싱 성공",
    toastSuccessUserRecordsCachedDesc: (nickname: string) => `${nickname}님의 사용자 기록이 로컬 저장소에 캐시되었습니다.`,
    toastErrorUserRecordsCacheFailed: "캐싱 실패",
    toastErrorUserRecordsCacheFailedDesc: (errorMsg?: string) => errorMsg ? errorMsg : "사용자 기록 캐싱 중 오류 발생.",
    toastInfoDevModeEnabled: "개발자 모드 활성화됨",
    toastInfoDevModeDisabled: "개발자 모드 비활성화됨",
    toastInfoAdminPanelShown: "관리자 패널 표시됨",
    toastInfoAdminPanelHidden: "관리자 패널 숨겨짐"
  },
  JP: {
    homePageTitle: "ChuniCalc",
    languageToggleKR: "KR (韓国語)",
    languageToggleJP: "JP (日本語)",
    // ChuniCalcForm
    formTitle: "ChuniCalc",
    formDescription: "チュウニズム成長シミュレーター。",
    nicknameLabel: "ユーザー名 (Chunirec User Name)",
    nicknamePlaceholder: "例: chunirec",
    fetchRatingButton: "読み込み",
    nicknameHelp: "Chunirecのニックネームを入力して現在のレーティングを読み込みします。",
    currentRatingLabel: "現在レーティング",
    currentRatingPlaceholder: "Chunirecユーザー名を入力して読み込んでください",
    targetRatingLabel: "目標レーティング",
    targetRatingPlaceholder: "例: 16.00",
    targetRatingHelp: "目標レーティングを入力してください。(最大 17.50)",
    calculateButton: "計算および結果表示",
    // AdvancedSettings
    advancedSettingsTitle: "個人設定",
    advancedSettingsDescription: "ローカルAPIキーの設定機能を使用します。",
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
    appVersion: "ChuniCalc v1.0.0",
    adminPanelToggleShow: "管理者パネル表示",
    adminPanelToggleHide: "管理者パネル非表示",
    // Toast Messages JP
    toastErrorApiKeyNotSet: "API設定エラー",
    toastErrorApiKeyNotSetDesc: "Chunirec APIトークンが設定されていません。詳細設定でローカルトークンを入力するか、環境変数を確認してください。",
    toastErrorNicknameNeeded: "ニックネーム必須",
    toastErrorNicknameNeededDesc: "ニックネームを入力してレーティングを照会してください。",
    toastErrorApiKeyMissing: "APIトークンがありません",
    toastErrorApiKeyMissingDesc: "APIトークンが設定されていないため、レーティングを照会できません。詳細設定または環境変数を確認してください。",
    toastErrorUserNotFound: "ユーザーが見つかりません",
    toastErrorUserNotFoundDesc: (nickname: string) => `ニックネーム「${nickname}」のユーザーが見つからないか、プレイデータがありません。`,
    toastErrorAccessDenied: "アクセス拒否",
    toastErrorAccessDeniedDesc: (nickname: string, code?: number) => code ? `ユーザー「${nickname}」のデータへのアクセス権がありません。(エラーコード: ${code})` : "非公開ユーザーかフレンドではないためアクセスできません。",
    toastErrorApiRequestFailed: "APIリクエスト失敗",
    toastErrorApiRequestFailedDesc: (status: number, message?: string) => `APIリクエスト失敗 (ステータス: ${status})${message ? `: ${message}` : ''}`,
    toastSuccessRatingFetched: "レーティング照会成功！",
    toastSuccessRatingFetchedDesc: (playerName: string, rating: string) => `「${playerName}」さんの現在レーティング: ${rating}`,
    toastErrorInvalidRatingData: "データエラー",
    toastErrorInvalidRatingDataDesc: "レーティング情報を取得しましたが、形式が正しくないか、プレイデータがありません。",
    toastErrorRatingFetchFailed: "照会失敗",
    toastErrorRatingFetchFailedDesc: (errorMsg: string) => `レーティング取得中にエラーが発生しました: ${errorMsg}`,
    toastErrorMissingInfo: "情報不足",
    toastErrorMissingInfoDesc: "現在レーティング(照会必要)と目標レーティングを両方入力してください。",
    toastErrorInvalidInput: "不正な入力",
    toastErrorInvalidInputDesc: "レーティングは数値で入力する必要があります。",
    toastErrorInvalidRatingRange: "不正なレーティング範囲",
    toastErrorInvalidRatingRangeDesc: "現在レーティングは0.00～17.49、目標レーティングは0.00～17.50の間である必要があります。",
    toastErrorTargetRating: "目標レーティングエラー",
    toastErrorTargetRatingDesc: "目標レーティングは現在レーティングより高くする必要があります。",
    toastErrorCurrentRatingTooHigh: "現在レーティングが高すぎます",
    toastErrorCurrentRatingTooHighDesc: "現在レーティングが17.50以上です。この計算機ではこれ以上の成長を予測できません。",
    toastSuccessLocalApiKeySaved: "ローカルAPIキー保存完了",
    toastSuccessLocalApiKeySavedDesc: "入力されたAPIキーがローカルストレージに保存されました。",
    toastSuccessLocalApiKeyRemoved: "ローカルAPIキー削除完了",
    toastSuccessLocalApiKeyRemovedDesc: "ローカルAPIキーが空のため、ストレージから削除されました。",
    toastSuccessLocalDataCleared: "ローカルデータ削除完了",
    toastSuccessLocalDataClearedDesc: (count: number) => `${count}個のアプリ関連ローカルキャッシュデータが削除されました。`,
    toastInfoCachingStarted: "キャッシング開始",
    toastInfoCachingStartedDesc: (target: string) => `${target}を取得中です...`,
    toastSuccessGlobalMusicCached: "キャッシング成功",
    toastSuccessGlobalMusicCachedDesc: "グローバル曲リストがローカルストレージにキャッシュされました。",
    toastErrorGlobalMusicCacheFailed: "キャッシング失敗",
    toastErrorGlobalMusicCacheFailedDesc: (errorMsg?: string) => errorMsg ? errorMsg : "グローバル曲リストのキャッシング中にエラーが発生しました。",
    toastSuccessUserRecordsCached: "キャッシング成功",
    toastSuccessUserRecordsCachedDesc: (nickname: string) => `${nickname}さんのユーザー記録がローカルストレージにキャッシュされました。`,
    toastErrorUserRecordsCacheFailed: "キャッシング失敗",
    toastErrorUserRecordsCacheFailedDesc: (errorMsg?: string) => errorMsg ? errorMsg : "ユーザー記録のキャッシング中にエラーが発生しました。",
    toastInfoDevModeEnabled: "開発者モード有効",
    toastInfoDevModeDisabled: "開発者モード無効",
    toastInfoAdminPanelShown: "管理者パネル表示",
    toastInfoAdminPanelHidden: "管理者パネル非表示"
  }
};

export type Locale = keyof typeof translations;

// This type helper will extract all keys from the KR translations.
// We assume KR has all the primary keys.
type BaseTranslationKeys = keyof typeof translations['KR'];

// This type will ensure that if a translation key returns a function,
// we can correctly type its arguments.
export type TranslationFunction<P extends any[] = any[], R = string> = (...args: P) => R;

// This mapped type will create a type where each key from BaseTranslationKeys
// maps to either a string or a TranslationFunction.
export type TranslationValues = {
  [K in BaseTranslationKeys]: (typeof translations)['KR'][K] extends TranslationFunction<infer P, infer R>
    ? TranslationFunction<P, R>
    : string;
};

// Overload signatures for getTranslation
export function getTranslation<K extends BaseTranslationKeys>(
  locale: Locale,
  key: K,
  ...args: (typeof translations)['KR'][K] extends TranslationFunction<infer P, any> ? P : []
): string {
  const primaryTranslations = translations[locale] || translations.KR;
  const fallbackTranslations = translations.KR;

  let messageOrFn = primaryTranslations[key as keyof typeof primaryTranslations];

  if (messageOrFn === undefined) {
    messageOrFn = fallbackTranslations[key as keyof typeof fallbackTranslations];
  }

  if (typeof messageOrFn === 'function') {
    // Type assertion is needed here because TypeScript can't infer the exact function signature
    // from the union type of all possible translation functions.
    return (messageOrFn as TranslationFunction)(...args);
  }
  return messageOrFn as string; // messageOrFn is a string here
}

    