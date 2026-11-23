import { useEffect } from 'react';
import { MAX_GALLERY_PHOTOS } from '@/domain/onlineStore';
import { useI18n } from '@/i18n/i18n';
import { prepareImage } from '@/services/storageService';
import type { GalleryItem } from './gallery';

interface Props {
  items: GalleryItem[];
  onChange: (next: GalleryItem[]) => void;
}

/** Up to five extra photos shown after the main one on the website. */
export function GalleryField({ items, onChange }: Props) {
  const { t } = useI18n();
  const room = MAX_GALLERY_PHOTOS - items.length;

  // Free the in-memory previews when the form closes.
  useEffect(
    () => () => {
      for (const it of items) if (it.kind === 'new') URL.revokeObjectURL(it.preview);
    },
    // Only on unmount: removing one photo revokes its own preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const add = (files: FileList | null) => {
    const picked = [...(files ?? [])].slice(0, Math.max(0, room));
    const fresh: GalleryItem[] = picked.map((file, i) => {
      const blob = prepareImage(file);
      blob.catch(() => undefined);
      return { kind: 'new', key: `new-${Date.now()}-${i}`, preview: URL.createObjectURL(file), blob };
    });
    onChange([...items, ...fresh]);
  };

  const remove = (key: string) => {
    const it = items.find((x) => x.key === key);
    if (it?.kind === 'new') URL.revokeObjectURL(it.preview);
    onChange(items.filter((x) => x.key !== key));
  };

  const first = (key: string) => {
    const it = items.find((x) => x.key === key);
    if (it) onChange([it, ...items.filter((x) => x.key !== key)]);
  };

  return (
    <div className="field">
      <span className="field__label">{t('products.gallery')}</span>
      <div className="gallery-field">
        {items.map((it, i) => (
          <div key={it.key} className="gallery-field__item">
            <img src={it.kind === 'saved' ? it.photo.url : it.preview} alt="" />
            <button type="button" className="gallery-field__x" aria-label={t('products.galleryRemove', { n: i + 1 })} onClick={() => remove(it.key)}>
              ×
            </button>
            {i > 0 && (
              <button type="button" className="gallery-field__first" onClick={() => first(it.key)}>
                {t('products.galleryFirst')}
              </button>
            )}
          </div>
        ))}
        {room > 0 && (
          <label className="gallery-field__add">
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => {
              add(e.target.files);
              e.target.value = '';
            }} />
            <span aria-hidden="true">+</span>
            <span>{t('products.galleryAdd', { n: room })}</span>
          </label>
        )}
      </div>
      <span className="field__hint">{t('products.galleryHint')}</span>
    </div>
  );
}
