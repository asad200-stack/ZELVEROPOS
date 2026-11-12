const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Only http(s) and data:image URLs may be embedded in printed documents. */
export function safeUrl(url: string | null | undefined): string {
  if (!url) return '';
  return /^(https:\/\/|http:\/\/localhost|http:\/\/127\.0\.0\.1|data:image\/)/i.test(url) ? url : '';
}

/**
 * Prints an HTML document through a hidden iframe (no pop-up blockers, no global CSS leakage).
 * `document.write` is used only inside that iframe, and only with HTML the caller already built
 * through `escapeHtml` / `safeUrl` (see `receipt.ts`). Never pass raw user strings here.
 * Resolves true once the browser print dialog is opened, false if printing cannot start.
 * The browser still asks the user to confirm the printer.
 */
export function printHtml(html: string): Promise<boolean> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(iframe);
    const docu = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!docu || !win) {
      iframe.remove();
      resolve(false);
      return;
    }
    docu.open();
    docu.write(html);
    docu.close();
    const cleanup = () => window.setTimeout(() => iframe.remove(), 500);
    let started = false;
    const doPrint = () => {
      if (started) return;
      started = true;
      try {
        win.focus();
        win.print();
        resolve(true);
      } catch {
        resolve(false);
      } finally {
        cleanup();
      }
    };
    const images = Array.from(docu.images);
    if (images.length === 0) {
      window.setTimeout(doPrint, 50);
      return;
    }
    let pending = images.length;
    const done = () => {
      pending -= 1;
      if (pending === 0) doPrint();
    };
    images.forEach((img) => {
      if (img.complete) done();
      else {
        img.onload = done;
        img.onerror = done;
      }
    });
    window.setTimeout(() => {
      if (pending > 0) {
        pending = 0;
        doPrint();
      }
    }, 3000);
  });
}
