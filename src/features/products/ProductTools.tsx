import { useEffect, useState } from 'react';
import { where } from 'firebase/firestore';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Form';
import { Alert, TableWrap } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { parseLbpInput, parseUsdInput } from '@/domain/money';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useCategories } from '@/hooks/useTenantData';
import { useI18n, type TranslationKey } from '@/i18n/i18n';
import { barcodesInUse, countWhere } from '@/services/catalogQuery';
import { addCategory, deleteCategory, importProducts, listMovements, renameCategory, type ImportRow } from '@/services/productService';
import type { MovementType, Product, StockMovement } from '@/types/models';
import { parseCsv } from '@/utils/csv';
import { formatDateTime } from '@/utils/format';
import { printBarcodeLabels } from './labels';

/* ------------------------------------------------------------- categories */

export function CategoriesModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { tenantId } = useTenant();
  const { confirm } = useFeedback();
  const categories = useCategories();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const { busy, run } = useAsyncAction('categories');

  useEffect(() => {
    let cancelled = false;
    Promise.all(categories.map(async (category) => [category, await countWhere(tenantId, 'products', [where('category', '==', category)])] as const))
      .then((rows) => {
        if (!cancelled) setCounts(Object.fromEntries(rows));
      })
      .catch((error: unknown) => console.error('[categories] counts', error));
    return () => {
      cancelled = true;
    };
  }, [tenantId, categories]);

  return (
    <Modal open title={t('products.categories')} onClose={onClose} busy={busy}>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await addCategory(tenantId, name);
            setName('');
          });
        }}
      >
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('products.newCategory')} maxLength={60} />
        <Button type="submit" icon="plus" loading={busy} disabled={!name.trim()}>
          {t('common.add')}
        </Button>
      </form>
      <ul className="plain-list">
        {categories.map((c) => (
          <li key={c} className="list-row">
            {renaming?.from === c ? (
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await renameCategory(tenantId, c, renaming.to);
                    setRenaming(null);
                  });
                }}
              >
                <input className="input" value={renaming.to} onChange={(e) => setRenaming({ from: c, to: e.target.value })} autoFocus />
                <Button type="submit" size="sm" loading={busy}>
                  {t('common.save')}
                </Button>
              </form>
            ) : (
              <>
                <span>
                  {c} <span className="muted small">({counts[c] ?? 0})</span>
                </span>
                <span>
                  <Button variant="ghost" size="sm" icon="edit" onClick={() => setRenaming({ from: c, to: c })} aria-label={t('common.edit')} />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="trash"
                    aria-label={t('common.delete')}
                    onClick={async () => {
                      if (await confirm({ title: t('products.deleteCategory', { name: c }), danger: true })) {
                        void run(() => deleteCategory(tenantId, c));
                      }
                    }}
                  />
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/* -------------------------------------------------------------- movements */

const MOVEMENT_LABEL: Record<MovementType, TranslationKey> = {
  sale: 'movement.sale',
  return: 'movement.return',
  purchase: 'movement.purchase',
  purchaseReturn: 'movement.purchaseReturn',
  adjustment: 'movement.adjustment',
  initial: 'movement.initial',
  packOpen: 'movement.packOpen',
};

export function MovementsModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { tenantId } = useTenant();
  const [data, setData] = useState<{ items: StockMovement[]; error: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMovements(tenantId, product.id)
      .then((items) => !cancelled && setData({ items, error: false }))
      .catch((e) => {
        console.error('[movements]', e);
        if (!cancelled) setData({ items: [], error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, product.id]);

  return (
    <Modal open size="lg" title={t('products.movementsFor', { name: product.name })} onClose={onClose}>
      {!data ? (
        <Spinner />
      ) : data.error ? (
        <Alert tone="error">{t('error.loadFailed')}</Alert>
      ) : data.items.length === 0 ? (
        <p className="muted">{t('common.noData')}</p>
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.date')}</th>
                <th>{t('common.type')}</th>
                <th className="num">{t('pos.qty')}</th>
                <th className="num">{t('products.stockAfter')}</th>
                <th>{t('common.reference')}</th>
                <th>{t('common.user')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((m) => (
                <tr key={m.id}>
                  <td>{formatDateTime(m.createdAt, lang)}</td>
                  <td>{t(MOVEMENT_LABEL[m.type])}</td>
                  <td className={m.quantity < 0 ? 'num text-danger' : 'num text-success'}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</td>
                  <td className="num">{m.stockAfter ?? '—'}</td>
                  <td>
                    {m.refNumber ?? ''} {m.note && <span className="muted small">{m.note}</span>}
                  </td>
                  <td>{m.createdByName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Modal>
  );
}

/* ----------------------------------------------------------------- labels */

export function LabelsModal({ products, onClose }: { products: Product[]; onClose: () => void }) {
  const { t } = useI18n();
  const [copies, setCopies] = useState<Record<string, string>>(() => Object.fromEntries(products.map((p) => [p.id, '1'])));
  const [showPrice, setShowPrice] = useState(true);
  return (
    <Modal
      open
      title={t('products.printLabels')}
      onClose={onClose}
      footer={
        <Button
          icon="printer"
          onClick={() => printBarcodeLabels(products.map((p) => ({ product: p, copies: Number(copies[p.id]) || 0 })), showPrice)}
        >
          {t('common.print')}
        </Button>
      }
    >
      <Checkbox label={t('products.labelShowPrice')} checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />
      <ul className="plain-list">
        {products.map((p) => (
          <li key={p.id} className="list-row">
            <span>
              {p.name}{' '}
              {p.barcode ? (
                <span className="muted small" dir="ltr">
                  {p.barcode}
                </span>
              ) : (
                <span className="muted small">{t('products.noBarcode')}</span>
              )}
            </span>
            <input
              className="input input--qty"
              dir="ltr"
              type="number"
              min={0}
              max={500}
              value={copies[p.id] ?? ''}
              onChange={(e) => setCopies((c) => ({ ...c, [p.id]: e.target.value }))}
              aria-label={t('products.copies')}
            />
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/* ----------------------------------------------------------------- import */

const IMPORT_HEADERS = ['name', 'barcode', 'category', 'retail', 'wholesale', 'vip', 'retail_lbp', 'cost', 'stock', 'min_stock', 'expiry_date', 'image_url'];

export function ImportProductsModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { tenantId } = useTenant();
  const { notify } = useFeedback();
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const { busy, run } = useAsyncAction('import');

  const onFile = async (file: File) => {
    const table = parseCsv(await file.text());
    const [header, ...body] = table;
    const idx = (name: string) => header?.findIndex((h) => h.trim().toLowerCase() === name) ?? -1;
    const errs: string[] = [];
    const existing = await barcodesInUse(
      tenantId,
      body.map((r) => (idx('barcode') >= 0 ? (r[idx('barcode')] ?? '').trim() : '')),
    );
    const seen = new Set<string>();
    const parsed: ImportRow[] = [];
    if (idx('name') < 0 || idx('retail') < 0) errs.push(t('products.importMissingColumns'));
    else
      body.forEach((r, i) => {
        const get = (n: string) => (idx(n) >= 0 ? (r[idx(n)] ?? '').trim() : '');
        const line = i + 2;
        const name = get('name');
        const retail = parseUsdInput(get('retail'));
        const barcode = get('barcode');
        if (!name || retail === null) return errs.push(t('products.importBadRow', { line }));
        if (barcode && (existing.has(barcode) || seen.has(barcode))) return errs.push(t('products.importDuplicate', { line, barcode }));
        if (barcode) seen.add(barcode);
        const wholesale = parseUsdInput(get('wholesale')) ?? retail;
        const vip = parseUsdInput(get('vip')) ?? retail;
        const expiry = get('expiry_date');
        const imageUrl = get('image_url');
        parsed.push({
          name: name.slice(0, 150),
          barcode: barcode.slice(0, 64),
          category: get('category').slice(0, 60),
          prices: {
            retail: { usdCents: retail, lbp: parseLbpInput(get('retail_lbp')) || null },
            wholesale: { usdCents: wholesale, lbp: null },
            vip: { usdCents: vip, lbp: null },
          },
          costUsdCents: parseUsdInput(get('cost')) ?? 0,
          stock: Math.max(0, Math.floor(Number(get('stock')) || 0)),
          minStock: get('min_stock') ? Math.max(0, Math.floor(Number(get('min_stock')) || 0)) : null,
          expiryDate: /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? expiry : null,
          imageUrl: imageUrl ? imageUrl.slice(0, 2000) : null,
        });
      });
    setRows(parsed);
    setErrors(errs);
  };

  return (
    <Modal
      open
      title={t('products.import')}
      onClose={onClose}
      busy={busy}
      footer={
        <Button
          loading={busy}
          disabled={!rows?.length}
          onClick={() =>
            void run(async () => {
              const n = await importProducts(rows ?? [], setProgress);
              notify('success', t('products.imported', { count: n }));
              onClose();
            })
          }
        >
          {t('products.importCount', { count: rows?.length ?? 0 })}
        </Button>
      }
    >
      <div className="stack">
        <p className="muted small">{t('products.importHint')}</p>
        <code className="code-block">{IMPORT_HEADERS.join(',')}</code>
        <input className="input" type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        {busy && <p>{t('products.importProgress', { done: progress, total: rows?.length ?? 0 })}</p>}
        {errors.length > 0 && (
          <Alert tone="warning">
            <ul className="plain-list">
              {errors.slice(0, 20).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Alert>
        )}
      </div>
    </Modal>
  );
}