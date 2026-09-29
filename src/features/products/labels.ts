import JsBarcode from 'jsbarcode';
import type { Product } from '@/types/models';
import { formatUsd } from '@/utils/format';
import { escapeHtml as e, printHtml } from '@/utils/html';

function barcodeSvg(code: string): string {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    JsBarcode(svg, code, { format: 'CODE128', width: 1.6, height: 38, fontSize: 12, margin: 0, displayValue: true });
    return svg.outerHTML;
  } catch {
    return `<div>${e(code)}</div>`;
  }
}

/** Prints barcode labels (50×25 mm) for the given products and copy counts. */
export function printBarcodeLabels(items: { product: Product; copies: number }[], showPrice: boolean): void {
  const labels = items
    .flatMap(({ product, copies }) =>
      Array.from({ length: Math.max(0, Math.min(500, copies)) }, () => {
        const code = product.barcode || product.id.slice(0, 12).toUpperCase();
        return `<div class="label"><div class="name">${e(product.name)}</div>${barcodeSvg(code)}${
          showPrice ? `<div class="price">${e(formatUsd(product.prices.retail.usdCents))}</div>` : ''
        }</div>`;
      }),
    )
    .join('');
  printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>
    @page{size:50mm 25mm;margin:0}*{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,sans-serif}
    .label{width:50mm;height:25mm;padding:1mm 2mm;display:flex;flex-direction:column;align-items:center;justify-content:center;page-break-after:always;overflow:hidden}
    .name{font-size:8pt;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
    .price{font-size:9pt;font-weight:700}svg{max-width:100%;height:auto}
  </style></head><body>${labels}</body></html>`);
}
