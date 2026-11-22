import type { StoreBranding, StoreLocale, StoreSection, StoreTemplate, StoreTheme } from '@/domain/onlineStore';

/** Kinds of shop the owner can start from; each sets a matching look in one tap. */
export const STORE_KINDS = ['perfume', 'clothing', 'shoes', 'food', 'electronics', 'grocery', 'general'] as const;
export type StoreKind = (typeof STORE_KINDS)[number];

interface Preset {
  theme: StoreTheme;
  template: StoreTemplate;
  primaryColor: string;
  accentColor: string;
  sections: StoreSection[];
  copy: Record<StoreLocale, { title: string; subtitle: string; cta: string }>;
}

export const STORE_PRESETS: Record<StoreKind, Preset> = {
  perfume: {
    theme: 'perfume',
    template: 'retail',
    primaryColor: '#C9A46A',
    accentColor: '#7A5A44',
    sections: ['bestSellers', 'newArrivals', 'catalog', 'categories'],
    copy: {
      ar: { title: 'عطر بيحكي عنك', subtitle: 'تشكيلة مختارة من أرقى العطور، بتوصل لباب بيتك.', cta: 'اكتشف العطور' },
      en: { title: 'A scent that speaks for you', subtitle: 'A chosen collection of fine fragrances, delivered to your door.', cta: 'Discover the scents' },
    },
  },
  clothing: {
    theme: 'atelier',
    template: 'retail',
    primaryColor: '#1C1A17',
    accentColor: '#B9A88F',
    sections: ['catalog', 'newArrivals', 'categories', 'bestSellers'],
    copy: {
      ar: { title: 'قطع قليلة، مخيّطة بعناية', subtitle: 'تشكيلة الموسم وصلت. اختار قطعتك وبتوصل لباب بيتك.', cta: 'تسوّق التشكيلة' },
      en: { title: 'Few pieces, made with care', subtitle: 'The new season is here. Pick your piece and we deliver it.', cta: 'Shop the collection' },
    },
  },
  shoes: {
    theme: 'studio',
    template: 'retail',
    primaryColor: '#FF4A1C',
    accentColor: '#111111',
    sections: ['newArrivals', 'catalog', 'bestSellers', 'categories'],
    copy: {
      ar: { title: 'خطوتك الجاية بتبلّش هون', subtitle: 'أحذية وشنط مختارة، بكل المقاسات وتوصيل لباب البيت.', cta: 'شوف الموديلات' },
      en: { title: 'Your next step starts here', subtitle: 'Chosen shoes and bags in every size, delivered to your door.', cta: 'See the styles' },
    },
  },
  food: {
    theme: 'bistro',
    template: 'restaurant',
    primaryColor: '#2F4A33',
    accentColor: '#E0A82E',
    sections: ['bestSellers', 'catalog', 'categories', 'newArrivals'],
    copy: {
      ar: { title: 'أكل طازة كل يوم', subtitle: 'اطلب هلأ وبيوصلك سخن.', cta: 'شوف المنيو' },
      en: { title: 'Fresh food, every day', subtitle: 'Order now and get it hot at your door.', cta: 'See the menu' },
    },
  },
  electronics: {
    theme: 'studio',
    template: 'retail',
    primaryColor: '#2563EB',
    accentColor: '#111111',
    sections: ['newArrivals', 'bestSellers', 'catalog', 'categories'],
    copy: {
      ar: { title: 'أحدث الأجهزة بإيدك', subtitle: 'موبايلات وإكسسوارات أصلية، بكفالة وتوصيل سريع.', cta: 'تسوّق الأجهزة' },
      en: { title: 'The latest tech in your hands', subtitle: 'Original phones and accessories, with warranty and fast delivery.', cta: 'Shop devices' },
    },
  },
  grocery: {
    theme: 'classic',
    template: 'grocery',
    primaryColor: '#15803D',
    accentColor: '#F59E0B',
    sections: ['categories', 'bestSellers', 'catalog', 'newArrivals'],
    copy: {
      ar: { title: 'كل أغراض البيت بطلب واحد', subtitle: 'خضرة، لحوم، ومواد غذائية بتوصل لباب البيت.', cta: 'ابدأ التسوّق' },
      en: { title: 'Your whole shopping in one order', subtitle: 'Fresh produce, meat and pantry goods delivered to your door.', cta: 'Start shopping' },
    },
  },
  general: {
    theme: 'classic',
    template: 'retail',
    primaryColor: '#1F6FEB',
    accentColor: '#F59E0B',
    sections: ['categories', 'bestSellers', 'newArrivals', 'catalog'],
    copy: {
      ar: { title: '', subtitle: '', cta: '' },
      en: { title: '', subtitle: '', cta: '' },
    },
  },
};

/**
 * The draft after picking a kind of shop. Look and section order follow the preset; the
 * headline texts are filled only where the owner hasn't written their own yet.
 */
export function applyPreset(draft: StoreBranding, kind: StoreKind): StoreBranding {
  const p = STORE_PRESETS[kind];
  const copy = p.copy[draft.defaultLocale] ?? p.copy.ar;
  return {
    ...draft,
    theme: p.theme,
    template: p.template,
    primaryColor: p.primaryColor,
    accentColor: p.accentColor,
    sections: [...p.sections],
    heroTitle: draft.heroTitle || copy.title,
    heroSubtitle: draft.heroSubtitle || copy.subtitle,
    heroCta: draft.heroCta || copy.cta,
  };
}

/** Which preset the draft currently matches (theme + colours), if any. */
export function matchingKind(draft: StoreBranding): StoreKind | null {
  return (
    STORE_KINDS.find((k) => {
      const p = STORE_PRESETS[k];
      return p.theme === draft.theme && p.primaryColor === draft.primaryColor.toUpperCase();
    }) ?? null
  );
}
