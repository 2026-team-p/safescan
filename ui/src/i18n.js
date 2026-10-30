// 화면 언어: 한국어(기본) · English · 日本語 · Español · 中文
// 문장은 ui/src/locales/<언어>.json 에 있고, 언어를 더하려면 파일 하나와 LANGS 한 줄을 추가합니다.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import es from './locales/es.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import zh from './locales/zh.json';

export const LANGS = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'es', label: 'Español' },
  { code: 'zh', label: '中文' },
];

const KEY = 'safescan:lang';

function initialLanguage() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && LANGS.some((l) => l.code === saved)) return saved;
  } catch { /* 저장소를 못 쓰면 브라우저 언어 */ }
  const browser = (navigator.language || 'ko').slice(0, 2);
  return LANGS.some((l) => l.code === browser) ? browser : 'ko';
}

i18n.use(initReactI18next).init({
  resources: { ko: { translation: ko }, en: { translation: en }, ja: { translation: ja }, es: { translation: es }, zh: { translation: zh } },
  lng: initialLanguage(),
  fallbackLng: 'ko',
  interpolation: { escapeValue: false }, // React 가 이미 이스케이프합니다
  returnNull: false,
});

document.documentElement.lang = i18n.language;
i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem(KEY, lng);
  } catch { /* 다음 방문에 기억하지 못할 뿐 */ }
});

/** 모듈 이름 · 설명 · 신뢰도 구간 이름 · 옵션 문구를 화면 언어로 (module.json 의 i18n, 없으면 기본값) */
export function localizeModule(module, lang) {
  const t = module?.i18n?.[lang] ?? module?.i18n?.[lang?.slice(0, 2)] ?? {};
  return {
    name: t.name ?? module.name,
    description: t.description ?? module.description,
    criteriaLabel: (i, fallback) => t.criteria?.[i] ?? fallback,
    option: (key) => {
      const spec = module.options?.[key] ?? {};
      const o = t.options?.[key] ?? {};
      return {
        label: o.label ?? spec.label ?? key,
        description: o.description ?? spec.description,
        placeholder: o.placeholder ?? spec.placeholder,
        unit: o.unit ?? spec.unit,
        choice: (value) => o.choiceLabels?.[value] ?? spec.choiceLabels?.[value] ?? value,
      };
    },
  };
}

export default i18n;
