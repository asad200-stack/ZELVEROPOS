import { createContext, useContext } from 'react';
import { en, type TranslationKey } from './en';
import { ar } from './ar';

export type Lang = 'en' | 'ar';
export type { TranslationKey };
export type TParams = Record<string, string | number>;
export type TFunction = (key: TranslationKey, params?: TParams) => string;

const dictionaries: Record<Lang, Record<TranslationKey, string>> = { en, ar };

export function translate(lang: Lang, key: TranslationKey, params?: TParams): string {
  const template = dictionaries[lang][key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

export function isTranslationKey(key: string): key is TranslationKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

export interface I18nValue {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  setLang: (lang: Lang) => void;
  t: TFunction;
}

export const I18nContext = createContext<I18nValue | null>(null);

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
