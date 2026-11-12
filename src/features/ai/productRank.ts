/**
 * Ranks products from posted sale lines.
 * Net units are quantity minus the returned quantity stored on that line.
 * A repeated sale id is counted once. Customer fields are not accepted here.
 */

export interface RankLine {
  productId: string;
  name: string;
  quantity: number;
  returnedQty: number;
  unitUsdCents: number;
  unitLbp: number;
}

export interface RankSale {
  id: string;
  soldOn: string;
  currency: 'USD' | 'LBP';
  lines: RankLine[];
}

export interface RankRow {
  productId: string;
  name: string;
  aliases: string[];
  netUnits: number;
  netUsdCents: number;
  netLbp: number;
  tied: boolean;
}

export interface ProductRank {
  rows: RankRow[];
  currencies: Array<'USD' | 'LBP'>;
  saleCount: number;
}

function netOf(line: RankLine): number {
  const quantity = Math.max(0, Math.round(line.quantity));
  const returned = Math.max(0, Math.round(line.returnedQty));
  return Math.max(0, quantity - returned);
}

export function rankProducts(sales: RankSale[], metric: 'units' | 'revenue' = 'units'): ProductRank {
  const seen = new Set<string>();
  const grouped = new Map<string, {
    names: Map<string, { units: number; latest: string }>;
    netUnits: number;
    netUsdCents: number;
    netLbp: number;
  }>();
  const currencies = new Set<'USD' | 'LBP'>();
  let saleCount = 0;

  for (const sale of sales) {
    if (seen.has(sale.id)) continue;
    seen.add(sale.id);
    saleCount += 1;
    let contributed = false;
    for (const line of sale.lines) {
      const net = netOf(line);
      if (net <= 0 || line.productId.trim() === '') continue;
      contributed = true;
      const bucket = grouped.get(line.productId) ?? {
        names: new Map<string, { units: number; latest: string }>(),
        netUnits: 0,
        netUsdCents: 0,
        netLbp: 0,
      };
      const label = line.name.trim() || line.productId;
      const name = bucket.names.get(label) ?? { units: 0, latest: sale.soldOn };
      name.units += net;
      if (sale.soldOn > name.latest) name.latest = sale.soldOn;
      bucket.names.set(label, name);
      bucket.netUnits += net;
      if (sale.currency === 'USD') bucket.netUsdCents += net * Math.round(line.unitUsdCents);
      if (sale.currency === 'LBP') bucket.netLbp += net * Math.round(line.unitLbp);
      grouped.set(line.productId, bucket);
    }
    if (contributed) currencies.add(sale.currency);
  }

  const rows: RankRow[] = [...grouped.entries()].map(([productId, bucket]) => {
    const labels = [...bucket.names.entries()].sort((a, b) => {
      if (a[1].latest !== b[1].latest) return a[1].latest < b[1].latest ? 1 : -1;
      if (a[1].units !== b[1].units) return b[1].units - a[1].units;
      return a[0].localeCompare(b[0]);
    });
    return {
      productId,
      name: labels[0]?.[0] ?? productId,
      aliases: labels.slice(1).map(([label]) => label),
      netUnits: bucket.netUnits,
      netUsdCents: bucket.netUsdCents,
      netLbp: bucket.netLbp,
      tied: false,
    };
  });

  const value = (row: RankRow) => {
    if (metric === 'units') return row.netUnits;
    const only = currencies.size === 1 ? [...currencies][0] : null;
    if (only === 'LBP') return row.netLbp;
    return row.netUsdCents;
  };
  rows.sort((a, b) => value(b) - value(a) || a.name.localeCompare(b.name));
  const values = rows.map(value);
  for (let i = 0; i < rows.length; i += 1) {
    rows[i]!.tied = values.filter((item) => item === values[i]).length > 1;
  }

  return { rows, currencies: [...currencies], saleCount };
}

export interface HeldProduct {
  id: string;
  name: string;
  stock: number;
}

export interface CatalogProduct {
  id: string;
  status: 'active' | 'archived';
}

export interface JoinedStockSale {
  id: string;
  name: string;
  stock: number;
  netUnits: number;
  invoiceName: string;
  tied: boolean;
}

export interface StockSalesJoin {
  matched: JoinedStockSale[];
  unsold: number;
  aside: { id: string; name: string; kind: 'archived' | 'missing' }[];
}

/** Current stock stays on the inventory row. Net units come from posted sale lines with the same product id. */
export function joinStockSales(held: HeldProduct[], sales: RankSale[], catalog: CatalogProduct[]): StockSalesJoin {
  const ranked = rankProducts(sales, 'units');
  const byId = new Map(ranked.rows.map((row) => [row.productId, row]));
  const heldIds = new Set<string>();
  const matched: JoinedStockSale[] = [];
  let unsold = 0;
  for (const item of held) {
    if (heldIds.has(item.id)) continue;
    heldIds.add(item.id);
    const row = byId.get(item.id);
    if (!row || row.netUnits <= 0) {
      unsold += 1;
      continue;
    }
    matched.push({
      id: item.id,
      name: item.name,
      stock: item.stock,
      netUnits: row.netUnits,
      invoiceName: row.name,
      tied: false,
    });
  }
  matched.sort((a, b) => b.netUnits - a.netUnits || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const counts = new Map<number, number>();
  for (const row of matched) counts.set(row.netUnits, (counts.get(row.netUnits) ?? 0) + 1);
  for (const row of matched) row.tied = (counts.get(row.netUnits) ?? 0) > 1;

  const catalogById = new Map(catalog.map((item) => [item.id, item]));
  const aside: StockSalesJoin['aside'] = [];
  for (const row of ranked.rows) {
    if (row.netUnits <= 0 || heldIds.has(row.productId)) continue;
    const known = catalogById.get(row.productId);
    if (known?.status === 'active') continue;
    aside.push({
      id: row.productId,
      name: row.name,
      kind: known?.status === 'archived' ? 'archived' : 'missing',
    });
  }
  aside.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { matched, unsold, aside };
}
