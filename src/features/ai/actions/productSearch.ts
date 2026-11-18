import { emptyProductQuery } from '@/domain/catalogPlan';
import { pageProducts } from '@/services/catalogQuery';
import type { Product } from '@/types/models';

export async function searchProductsByName(tenantId: string, raw: string, limit = 8): Promise<Product[]> {
  const search = raw.trim();
  if (!search) return [];
  const page = await pageProducts(tenantId, emptyProductQuery({ search, mode: 'browse' }), null);
  const needle = search.toLowerCase();
  const scored = page.items
    .map((product) => {
      const name = product.name.toLowerCase();
      let score: number;
      if (name === needle) score = 100;
      else if (name.startsWith(needle)) score = 80;
      else if (name.includes(needle)) score = 50;
      else score = 10;
      return { product, score };
    })
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name));
  return scored.slice(0, limit).map((row) => row.product);
}

export function extractProductQuery(text: string): string | null {
  const q = text.trim();
  const m =
    q.match(/\b(?:find|search|look\s*up|show)\s+(?:the\s+)?(?:product\s+)?(.+)$/i) ||
    q.match(/(?:دور(?:ي)?\s*على|فتّش(?: عن)?|ابحث(?: عن)?)\s+(.+)$/i) ||
    q.match(/\b(?:add|put)\s+(\d+\s+)?(?:more\s+)?(.+?)\s+to\s+(?:the\s+)?cart\b/i) ||
    q.match(/\badd\s+(\d+\s+)?(.+)$/i) ||
    q.match(/(?:حط(?:لي)?|ضيف(?:لي)?|أضف(?:لي)?)\s+(\d+\s+)?(.+?)\s*(?:بالكارت|بالسلة|للسلة|عالسلة|كارت)/i) ||
    q.match(/بدّ?ي\s*بيع\s+(.+)$/i) ||
    q.match(/(?:ضيف|أضف|شيل|احذف)\s+(\d+\s+)?(.+?)(?:\s+للسلة|\s+عالسلة)?$/i);
  if (m) {
    const name = (m[2] || m[1] || '').replace(/\bto\s+(?:the\s+)?cart\b/i, '').replace(/(?:بالكارت|بالسلة|للسلة|عالسلة|كارت)\s*$/i, '').trim();
    if (name && !/^(a|an|the|product|منتج|new)$/i.test(name)) return name;
  }
  return null;
}
