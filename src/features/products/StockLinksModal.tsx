import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { emptyProductQuery } from '@/domain/catalogPlan';
import { STOCK_LINKS_MAX, STOCK_LINK_QTY_MAX, isLinked, linksOf } from '@/domain/stockUnits';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useI18n } from '@/i18n/i18n';
import { getProductsByIds, pageProducts } from '@/services/catalogQuery';
import { setStockLinks } from '@/services/productService';
import type { Product } from '@/types/models';

interface Row {
  productId: string;
  name: string;
  quantity: string;
}

/**
 * Cartons and sets: this product sells from other products' stock. One row = a carton
 * (e.g. coal box × 10); several rows = a set (base × 1, hose × 1, head × 2).
 */
export function StockLinksModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { t } = useI18n();
  const { tenantId } = useTenant();
  const { notify } = useFeedback();
  const { busy, run } = useAsyncAction('stock-links');
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<Product[]>([]);

  useEffect(() => {
    const links = linksOf(product);
    if (!links.length) return;
    let live = true;
    void getProductsByIds(tenantId, links.map((l) => l.productId)).then((parts) => {
      if (!live) return;
      const names = new Map(parts.map((p) => [p.id, p.name]));
      setRows(links.map((l) => ({ productId: l.productId, name: names.get(l.productId) ?? l.productId, quantity: String(l.quantity) })));
    });
    return () => {
      live = false;
    };
  }, [product, tenantId]);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      void pageProducts(tenantId, emptyProductQuery({ search: q }), null).then((page) => {
        if (live) setFound(page.items.filter((p) => p.id !== product.id && !isLinked(p) && !p.imeiTracking && p.status === 'active').slice(0, 8));
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search, tenantId, product.id]);

  const add = (p: Product) => {
    if (rows.some((r) => r.productId === p.id) || rows.length >= STOCK_LINKS_MAX) return;
    setRows((list) => [...list, { productId: p.id, name: p.name, quantity: '1' }]);
    setSearch('');
    setFound([]);
  };

  const qtyOk = (v: string) => /^\d+$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= STOCK_LINK_QTY_MAX;
  const valid = rows.every((r) => qtyOk(r.quantity));
  const ownStock = !isLinked(product) && product.stock !== 0;

  const save = (list: Row[]) =>
    run(async () => {
      await setStockLinks(product.id, list.map((r) => ({ productId: r.productId, quantity: Number(r.quantity) })));
      notify('success', list.length ? t('stockLinks.saved') : t('stockLinks.cleared'));
      onClose();
    });

  return (
    <Modal
      open
      title={t('stockLinks.titleFor', { name: product.name })}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {isLinked(product) && (
            <Button variant="secondary" onClick={() => void save([])} disabled={busy}>
              {t('stockLinks.turnOff')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} disabled={!rows.length || !valid || ownStock} onClick={() => void save(rows)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="muted">{t('stockLinks.explain')}</p>
        {ownStock && <Alert tone="warning">{t('stockLinks.hasOwnStock', { count: product.stock })}</Alert>}
        {rows.map((r, i) => (
          <div key={r.productId} className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
            <div style={{ flex: 1 }}>{r.name}</div>
            <TextInput
              label={t('stockLinks.piecesPerUnit')}
              inputMode="numeric"
              value={r.quantity}
              error={qtyOk(r.quantity) ? undefined : t('stockLinks.qtyInvalid')}
              onChange={(e) => setRows((list) => list.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
            />
            <Button variant="ghost" size="sm" icon="trash" aria-label={t('common.delete')} onClick={() => setRows((list) => list.filter((_, j) => j !== i))} />
          </div>
        ))}
        <TextInput label={t('stockLinks.addPart')} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('stockLinks.searchHint')} />
        {search.trim().length >= 2 &&
          found.map((p) => (
            <Button key={p.id} variant="secondary" size="sm" onClick={() => add(p)}>
              {t('stockLinks.addThis', { name: p.name, count: p.stock })}
            </Button>
          ))}
      </div>
    </Modal>
  );
}
