import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { emptyProductQuery } from '@/domain/catalogPlan';
import { PACK_SIZE_MAX, PACK_SIZE_MIN, isLinked } from '@/domain/stockUnits';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useI18n } from '@/i18n/i18n';
import { getProductsByIds, pageProducts } from '@/services/catalogQuery';
import { openPack, setPackOf } from '@/services/productService';
import type { Product } from '@/types/models';

/** "This carton holds N of that piece." Set once; afterwards the carton is opened with OpenPackModal. */
export function PackModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { t } = useI18n();
  const { tenantId } = useTenant();
  const { notify } = useFeedback();
  const { busy, run } = useAsyncAction('pack-of');
  const [piece, setPiece] = useState<{ id: string; name: string } | null>(null);
  const [qty, setQty] = useState(String(product.packOf?.quantity ?? 10));
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<Product[]>([]);

  useEffect(() => {
    const id = product.packOf?.productId;
    if (!id) return;
    let live = true;
    void getProductsByIds(tenantId, [id]).then(([p]) => live && setPiece({ id, name: p?.name ?? id }));
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
        if (live) setFound(page.items.filter((p) => p.id !== product.id && !isLinked(p) && !p.packOf && !p.imeiTracking && p.status === 'active').slice(0, 8));
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search, tenantId, product.id]);

  const n = Number(qty);
  const qtyOk = /^\d+$/.test(qty.trim()) && n >= PACK_SIZE_MIN && n <= PACK_SIZE_MAX;
  const save = (clear: boolean) =>
    run(async () => {
      await setPackOf(product.id, clear || !piece ? null : { productId: piece.id, quantity: n });
      notify('success', clear ? t('pack.cleared') : t('pack.saved', { n, piece: piece?.name ?? '' }));
      onClose();
    });

  return (
    <Modal
      open
      title={t('pack.titleFor', { name: product.name })}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {product.packOf && (
            <Button variant="secondary" onClick={() => void save(true)} disabled={busy}>
              {t('pack.turnOff')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} disabled={!piece || !qtyOk} onClick={() => void save(false)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="muted">{t('pack.explain')}</p>
        {piece ? (
          <Alert tone="info">{t('pack.contains', { piece: piece.name })}</Alert>
        ) : (
          <>
            <TextInput label={t('pack.pickPiece')} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('stockLinks.searchHint')} />
            {search.trim().length >= 2 &&
              found.map((p) => (
                <Button key={p.id} variant="secondary" size="sm" onClick={() => setPiece({ id: p.id, name: p.name })}>
                  {t('stockLinks.addThis', { name: p.name, count: p.stock })}
                </Button>
              ))}
          </>
        )}
        {piece && (
          <Button variant="ghost" size="sm" onClick={() => setPiece(null)}>
            {t('pack.changePiece')}
          </Button>
        )}
        <TextInput
          label={t('pack.howMany')}
          inputMode="numeric"
          value={qty}
          error={qtyOk ? undefined : t('pack.qtyInvalid')}
          onChange={(e) => setQty(e.target.value)}
        />
      </div>
    </Modal>
  );
}

/** Opens cartons at the shop: the pieces go into the piece's stock. */
export function OpenPackModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { t } = useI18n();
  const { tenantId } = useTenant();
  const { notify } = useFeedback();
  const { busy, run } = useAsyncAction('open-pack');
  const [count, setCount] = useState('1');
  const [pieceName, setPieceName] = useState('');
  const size = product.packOf?.quantity ?? 0;

  useEffect(() => {
    const id = product.packOf?.productId;
    if (!id) return;
    let live = true;
    void getProductsByIds(tenantId, [id]).then(([p]) => live && setPieceName(p?.name ?? ''));
    return () => {
      live = false;
    };
  }, [product, tenantId]);

  const c = Number(count);
  const ok = /^\d+$/.test(count.trim()) && c >= 1 && c <= product.stock;
  const submit = () =>
    run(async () => {
      const res = await openPack(product.id, c);
      notify('success', t('pack.opened', { pieces: res.pieces, piece: pieceName, stock: res.pieceStock }));
      onClose();
    });

  return (
    <Modal
      open
      title={t('pack.openTitle', { name: product.name })}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} disabled={!ok} onClick={() => void submit()}>
            {t('pack.open')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="muted">{t('pack.available', { count: product.stock })}</p>
        <TextInput label={t('pack.howManyOpen')} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} autoFocus />
        {ok && <Alert tone="info">{t('pack.preview', { count: c, pieces: c * size, piece: pieceName })}</Alert>}
        {product.stock < 1 && <Alert tone="warning">{t('pack.none')}</Alert>}
      </div>
    </Modal>
  );
}
