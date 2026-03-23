import en from './en';
import zh from './zh';

type Strings = typeof en;
type Key = keyof Strings;

function detectLanguage(): string {
  const htmlLang = document.documentElement.lang;
  if (htmlLang) return htmlLang.toLowerCase();
  const nav = navigator.language || '';
  return nav.toLowerCase();
}

const langCode = detectLanguage();
const isZh = langCode.startsWith('zh');

const strings: Strings = isZh ? zh : en;

export function t(key: Key): string {
  return strings[key] || en[key] || key;
}

export type { Key };
