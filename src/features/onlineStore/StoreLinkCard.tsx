import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Layout';
import { useI18n } from '@/i18n/i18n';

/** Once the store is published: its full public link, ready to open, copy or send on WhatsApp. */
export function StoreLinkCard({ slug, storeName }: { slug: string; storeName: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/s/${encodeURIComponent(slug)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t('onlineStore.linkCard.copy'), url);
    }
  };

  const share = `https://wa.me/?text=${encodeURIComponent(`${storeName.trim() ? `${storeName.trim()} ` : ''}${url}`)}`;

  return (
    <Card title={t('onlineStore.linkCard.title')}>
      <div className="store-link">
        <a className="store-link__url" href={url} target="_blank" rel="noopener noreferrer" dir="ltr">
          {url.replace(/^https?:\/\//, '')}
        </a>
        <div className="store-link__actions">
          <Button size="sm" onClick={() => window.open(url, '_blank', 'noopener')}>
            {t('onlineStore.linkCard.open')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void copy()}>
            {copied ? t('onlineStore.linkCard.copied') : t('onlineStore.linkCard.copy')}
          </Button>
          <a className="btn btn--secondary btn--sm" href={share} target="_blank" rel="noopener noreferrer">
            {t('onlineStore.linkCard.whatsapp')}
          </a>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {t('onlineStore.linkCard.hint')}
        </p>
      </div>
    </Card>
  );
}
