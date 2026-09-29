import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { STORAGE_KEYS } from '@/constants/app';
import { I18nContext, translate, type Lang } from './i18n';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.lang);
    if (saved === 'ar' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEYS.lang, next);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ lang, dir: dir as 'rtl' | 'ltr', setLang, t: translate.bind(null, lang) }),
    [lang, dir, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
