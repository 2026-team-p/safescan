import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './i18n.js';
import { applyTheme, loadTheme } from './lib/theme.js';
import './styles.css';

// 첫 그림 전에 화면 모드를 정해 깜빡임을 막습니다.
applyTheme(loadTheme());

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
