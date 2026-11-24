import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Layout';
import { useI18n } from '@/i18n/i18n';

/**
 * Once the store is published: the product catalogue link for Facebook / Instagram Shopping and
 * Google Merchant Center (updated by itself, read by them on a schedule), with the steps to add it.
 * Google Search finds the shop by itself (robots.txt lists every shop's sitemap).
 */
export function CatalogFeedCard({ slug }: { slug: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const feed = `${window.location.origin}/s/${encodeURIComponent(slug)}/feed.xml`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(feed);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card title={t('onlineStore.feed.title')}>
      <div className="store-link">
        <p className="muted" style={{ margin: 0 }}>
          {t('onlineStore.feed.hint')}
        </p>
        <code className="store-link__url" dir="ltr" style={{ userSelect: 'all' }}>
          {feed}
        </code>
        <div className="store-link__actions">
          <Button size="sm" variant="secondary" onClick={() => void copy()}>
            {copied ? t('onlineStore.linkCard.copied') : t('onlineStore.feed.copy')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => window.open(feed, '_blank', 'noopener')}>
            {t('onlineStore.feed.view')}
          </Button>
        </div>
        <div>
          <b>{t('onlineStore.feed.metaTitle')}</b>
          <ol className="muted" style={{ margin: '4px 0 0', paddingInlineStart: 20 }}>
            <li>{t('onlineStore.feed.meta1')}</li>
            <li>{t('onlineStore.feed.meta2')}</li>
            <li>{t('onlineStore.feed.meta3')}</li>
          </ol>
        </div>
        <div>
          <b>{t('onlineStore.feed.googleTitle')}</b>
          <ol className="muted" style={{ margin: '4px 0 0', paddingInlineStart: 20 }}>
            <li>{t('onlineStore.feed.google1')}</li>
            <li>{t('onlineStore.feed.google2')}</li>
          </ol>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {t('onlineStore.feed.search')}
        </p>
      </div>
    </Card>
  );
}
