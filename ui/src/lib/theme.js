// 화면 모드: system(운영체제 설정을 따름) · light · dark. <html data-theme> 로 styles.css 의 색 변수를 바꿉니다.
const KEY = 'safescan:theme';
export const THEMES = ['system', 'light', 'dark'];

export function loadTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    return THEMES.includes(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch { /* 다음 방문에 기억하지 못할 뿐 */ }
}
