import _zhCn from '../../l10n/bundle.l10n.zh-cn.json';
import _zhTr from '../../l10n/bundle.l10n.zh-tw.json';

function loadL10n(loc: string): Record<string, string> | undefined {
  if (loc === 'zh-cn') return _zhCn;
  else if (loc === 'zh-tr') return _zhTr;
  return undefined;
}

function getDefaultLocale() {
  let lang = (
    window.ICONIFY_INIT_DATA.locale ||
    localStorage.getItem('ENV_LANGUAGE') ||
    navigator.language ||
    'en'
  )
    .toLowerCase()
    .replace(/_/g, '-');
  if (lang === 'zh-cn') {
    //
  } else if (lang.startsWith('zh')) lang = 'zh-tr';
  else lang = 'en';
  return lang;
}
export const lang = getDefaultLocale();

const l10n = loadL10n(lang);

export function t(message: string) {
  return l10n?.[message] ?? message;
}
