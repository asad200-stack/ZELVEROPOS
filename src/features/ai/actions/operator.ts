import type { PermissionKey } from '@/constants/permissions';
import { getProductsByIds } from '@/services/catalogQuery';
import { createProduct } from '@/services/productService';
import { aiAccessDeniedText, canAccessZelveroAi } from '../aiAccess';
import {
  buildNavigateOffer,
  createFormDeniedText,
  createFormOpenedText,
  isShortAmbiguousFollowUp,
  isSoftAffirmative,
  isSoftNegative,
  noPendingAffirmText,
  offerClarificationText,
  offerRejectedText,
  supportsCreateForm,
  type PendingNavigateOffer,
} from './followUp';
import {
  financeCapabilityRefusalText,
  financeRefusalText,
  isFinancialCapabilityQuestion,
  isFinancialExecutionRequest,
  isStockExecutionRequest,
  stockRefusalText,
} from './financeGuard';
import { guideOfferPath, matchGuide, shortGuideAnswer } from './guide';
import { isSubUserSelfGrantAiQuestion, subUserSelfGrantAiText } from '../userFacingAnswer';
import {
  askMissingProductField,
  formatProductPreview,
  isCancelUtterance,
  isConfirmUtterance,
  isCreateProductRequest,
  looksLikeDraftFieldReply,
  missingProductFields,
  parseProductDraft,
  toProductInput,
  unknownCostSaveNote,
  type ProductDraftFields,
} from './productDraft';
import { extractProductQuery, searchProductsByName } from './productSearch';
import { canAccessNav, isNavigationRequest, resolveNavigateTarget } from './navigateIntent';
import { cartAdd, cartRemoveOne, isCartAddRequest, isCartRemoveRequest, parseCartQuantity } from './cartOps';
import { getPosCartHost } from './cartBridge';
import { classifyOperatorIntent, isGuideIntent } from './operatorIntent';
import {
  clearPendingOpenCreateForm,
  requestOpenCreateForm,
  type PageUiPath,
} from './pageUiBridge';

export type AiLang = 'ar' | 'en';

export type PendingOperator =
  | PendingNavigateOffer
  | { kind: 'createProduct'; draft: ProductDraftFields; submissionId: string }
  | { kind: 'cartAdd'; productId: string; productName: string; quantity: number; submissionId: string }
  | { kind: 'chooseProduct'; purpose: 'cartAdd'; quantity: number; matches: { id: string; name: string }[]; submissionId: string };

export interface OperatorContext {
  lang: AiLang;
  tenantId: string | null;
  route: string;
  isOwner: boolean;
  can: (permission: PermissionKey) => boolean;
  navigate: (path: string) => void;
  label: (key: string) => string;
}

export interface OperatorResult {
  handled: boolean;
  text: string;
  pending: PendingOperator | null;
  /** Hide knowledge sources for this reply. */
  conversational: boolean;
}

function langOf(question: string, ui: AiLang): AiLang {
  const arabic = /[\u0600-\u06FF]/.test(question);
  const latin = /[A-Za-z]/.test(question);
  if (arabic && !latin) return 'ar';
  if (latin && !arabic) return 'en';
  return ui;
}

function newSubmissionId(): string {
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pickByIndex(text: string, count: number): number | null {
  const m = text.trim().match(/^(?:#?\s*)(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1 || n > count) return null;
  return n - 1;
}

function canOpenCreateForm(path: string, ctx: OperatorContext): boolean {
  if (path === '/products') return ctx.isOwner || ctx.can('canAddProducts');
  if (path === '/customers') return ctx.isOwner || ctx.can('canViewCustomers');
  if (path === '/suppliers' || path === '/purchases') return ctx.isOwner || ctx.can('canViewSuppliers');
  return false;
}

function openPageCreateForm(path: string, ctx: OperatorContext): OperatorResult {
  const title = ctx.label(
    path === '/products'
      ? 'nav.products'
      : path === '/customers'
        ? 'nav.customers'
        : path === '/suppliers'
          ? 'nav.suppliers'
          : 'nav.purchases',
  );
  const lang = ctx.lang;
  if (!supportsCreateForm(path)) {
    return { handled: true, text: lang === 'ar' ? `تم فتح ${title}.` : `Opening ${title}.`, pending: null, conversational: true };
  }
  if (!canOpenCreateForm(path, ctx)) {
    clearPendingOpenCreateForm(path);
    ctx.navigate(path);
    return {
      handled: true,
      text: createFormDeniedText(path, title, lang),
      pending: null,
      conversational: true,
    };
  }
  ctx.navigate(path);
  requestOpenCreateForm(path);
  return {
    handled: true,
    text: createFormOpenedText(path, title, lang),
    pending: null,
    conversational: true,
  };
}

export async function handleOperatorTurn(
  question: string,
  ctx: OperatorContext,
  pending: PendingOperator | null,
): Promise<OperatorResult> {
  const lang = langOf(question, ctx.lang);
  const q = question.trim();

  // Defense-in-depth: assistant access before any operator / guide / navigate work.
  if (!canAccessZelveroAi(ctx)) {
    return {
      handled: true,
      text: aiAccessDeniedText(lang),
      pending: null,
      conversational: true,
    };
  }

  if ((isCancelUtterance(q) || isSoftNegative(q)) && pending) {
    return {
      handled: true,
      text: pending.kind === 'offerNavigate' ? offerRejectedText(lang) : lang === 'ar' ? 'تم إلغاء العملية.' : 'Cancelled.',
      pending: null,
      conversational: true,
    };
  }

  if (isFinancialCapabilityQuestion(q)) {
    return { handled: true, text: financeCapabilityRefusalText(lang), pending: null, conversational: true };
  }
  // Stock / finance writes before guides or live readers (dispatch layer).
  if (isStockExecutionRequest(q)) {
    return { handled: true, text: stockRefusalText(lang), pending: null, conversational: true };
  }
  if (isFinancialExecutionRequest(q)) {
    return { handled: true, text: financeRefusalText(lang), pending: null, conversational: true };
  }
  // Self-escalation must not be diluted by the generic Users guide.
  if (isSubUserSelfGrantAiQuestion(q)) {
    return { handled: true, text: subUserSelfGrantAiText(lang), pending: null, conversational: true };
  }

  // --- Resolve structured navigate offer on short yes/no ---
  if (pending?.kind === 'offerNavigate') {
    if (isSoftAffirmative(q) || isConfirmUtterance(q)) {
      if (!canAccessNav(pending, ctx)) {
        return {
          handled: true,
          text: lang === 'ar' ? 'ما عاد عندك صلاحية تفتح هالصفحة.' : 'You no longer have permission to open that page.',
          pending: null,
          conversational: true,
        };
      }
      ctx.navigate(pending.path);
      if (pending.openCreateForm && supportsCreateForm(pending.path)) {
        if (!canOpenCreateForm(pending.path, ctx)) {
          clearPendingOpenCreateForm(pending.path);
          const titleOnly = ctx.label(pending.labelKey);
          return {
            handled: true,
            text: createFormDeniedText(pending.path, titleOnly, lang),
            pending: null,
            conversational: true,
          };
        }
        requestOpenCreateForm(pending.path as PageUiPath);
      } else {
        clearPendingOpenCreateForm();
      }
      const title = ctx.label(pending.labelKey);
      return {
        handled: true,
        text: pending.openCreateForm
          ? createFormOpenedText(pending.path, title, lang)
          : lang === 'ar'
            ? `تم فتح ${title}.`
            : `Opening ${title}.`,
        pending: null,
        conversational: true,
      };
    }
    if (isShortAmbiguousFollowUp(q) && q.length <= 24) {
      return {
        handled: true,
        text: offerClarificationText(lang, pending.prompt),
        pending,
        conversational: true,
      };
    }
    // Unrelated new request: drop the offer and continue.
    pending = null;
  }

  // Bare "إيه" / "yes" with nothing pending — do not hit knowledge search.
  if (!pending && (isSoftAffirmative(q) || isConfirmUtterance(q)) && q.length <= 24) {
    return { handled: true, text: noPendingAffirmText(lang), pending: null, conversational: true };
  }

  const intent = classifyOperatorIntent(q);

  // --- Explain / how-to always wins; never continue or start a draft ---
  if (intent === 'guide' || isGuideIntent(q)) {
    const guide = shortGuideAnswer(q, lang);
    if (guide) {
      const suspended = pending
        ? lang === 'ar'
          ? '\n\n(علّقت العملية السابقة بدون تنفيذ.)'
          : '\n\n(Paused the previous operation without executing it.)'
        : '';
      const card = matchGuide(q);
      const offerPath = card?.offerPath ?? guideOfferPath(q);
      const offer = offerPath
        ? buildNavigateOffer(offerPath, newSubmissionId(), { openCreateForm: Boolean(card?.openCreateForm) })
        : null;
      return {
        handled: true,
        text: `${guide}${suspended}`,
        pending: offer,
        conversational: true,
      };
    }
  }

  // --- Navigation (page only — never auto-opens Add/Create form) ---
  if (isNavigationRequest(q)) {
    const target = resolveNavigateTarget(q);
    if (target) {
      if (!canAccessNav(target, ctx)) {
        return {
          handled: true,
          text: lang === 'ar' ? 'ما عندك صلاحية تفتح هالصفحة.' : 'You do not have permission to open that page.',
          pending,
          conversational: true,
        };
      }
      clearPendingOpenCreateForm();
      ctx.navigate(target.tab ? `${target.path}?tab=${target.tab}` : target.path);
      const title = target.title ? (lang === 'ar' ? target.title.ar : target.title.en) : ctx.label(target.labelKey);
      return {
        handled: true,
        text: lang === 'ar' ? `تم فتح ${title}.` : `Opening ${title}.`,
        pending: null,
        conversational: true,
      };
    }
  }

  // --- Continue product draft (only confirm / field replies — not how-to) ---
  if (pending?.kind === 'createProduct') {
    if (isConfirmUtterance(q)) {
      if (!ctx.tenantId) {
        return { handled: true, text: lang === 'ar' ? 'ما في متجر مرتبط.' : 'No store is linked.', pending, conversational: true };
      }
      if (!(ctx.isOwner || ctx.can('canAddProducts'))) {
        return {
          handled: true,
          text: lang === 'ar' ? 'ما عندك صلاحية إضافة منتجات.' : 'You do not have permission to add products.',
          pending: null,
          conversational: true,
        };
      }
      const input = toProductInput(pending.draft);
      if (!input) {
        const miss = missingProductFields(pending.draft)[0]!;
        return { handled: true, text: askMissingProductField(miss, lang), pending, conversational: true };
      }
      try {
        const saved = await createProduct(input, pending.submissionId);
        const note = input.costKnown === false ? `\n${unknownCostSaveNote(lang)}` : '';
        const text =
          lang === 'ar'
            ? saved.duplicate
              ? `هذا الحفظ اكتمل سابقاً. المنتج «${input.name}» (المعرّف ${saved.id}).`
              : `تم إنشاء المنتج «${input.name}» (المعرّف ${saved.id}).`
            : saved.duplicate
              ? `That save already completed. Product “${input.name}” (id ${saved.id}).`
              : `Created product “${input.name}” (id ${saved.id}).`;
        return {
          handled: true,
          text: `${text}${note}`,
          pending: null,
          conversational: true,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'error';
        return {
          handled: true,
          text: lang === 'ar' ? `ما قدر ينحفظ المنتج: ${message}` : `Could not save the product: ${message}`,
          pending,
          conversational: true,
        };
      }
    }

    // A repeated "add a product named …" is the details, not a new command to ignore.
    if (!isCreateProductRequest(q) && !looksLikeDraftFieldReply(q)) {
      return {
        handled: true,
        text:
          lang === 'ar'
            ? 'في مسودة منتج معلّقة. اكتب الاسم أو السعر، أو «تأكيد»، أو «إلغاء». إذا بدك شرح، اسأل «كيف بضيف منتج؟».'
            : 'A product draft is pending. Send the name or price, Confirm, or Cancel. For a how-to, ask “How do I add a product?”',
        pending,
        conversational: true,
      };
    }
    // A full "add a product …" sentence replaces the draft. Merging would keep
    // leftover wholesale/VIP zeros from an earlier misread of a single price.
    const draft = parseProductDraft(q, isCreateProductRequest(q) ? {} : pending.draft);
    requestOpenCreateForm('/products', draft);
    const missing = missingProductFields(draft);
    if (missing.length > 0) {
      return {
        handled: true,
        text: askMissingProductField(missing[0]!, lang),
        pending: { ...pending, draft },
        conversational: true,
      };
    }
    return {
      handled: true,
      text: formatProductPreview(draft, lang),
      pending: { ...pending, draft },
      conversational: true,
    };
  }

  // --- Choose among product matches ---
  if (pending?.kind === 'chooseProduct') {
    const idx = pickByIndex(q, pending.matches.length);
    let chosen = idx != null ? pending.matches[idx] : null;
    if (!chosen) {
      const hit = pending.matches.find((row) => row.name.toLowerCase() === q.toLowerCase());
      chosen = hit ?? null;
    }
    if (!chosen) {
      const list = pending.matches.map((row, i) => `${i + 1}. ${row.name}`).join('\n');
      return {
        handled: true,
        text: (lang === 'ar' ? 'اختر رقم المنتج:\n' : 'Pick a product number:\n') + list,
        pending,
        conversational: true,
      };
    }
    if (pending.purpose === 'cartAdd') {
      return await confirmOrAddCart(chosen.id, chosen.name, pending.quantity, lang, ctx, pending.submissionId);
    }
  }

  // --- Confirm cart add ---
  if (pending?.kind === 'cartAdd' && isConfirmUtterance(q)) {
    return await executeCartAdd(pending.productId, pending.productName, pending.quantity, lang, ctx);
  }

  // --- Create product (execute): open Products + Add product modal, then chat draft ---
  if (intent === 'createProduct' || isCreateProductRequest(q)) {
    if (!(ctx.isOwner || ctx.can('canAddProducts'))) {
      return {
        handled: true,
        text: lang === 'ar' ? 'ما عندك صلاحية إضافة منتجات.' : 'You do not have permission to add products.',
        pending: null,
        conversational: true,
      };
    }
    const draft = parseProductDraft(q);
    ctx.navigate('/products');
    requestOpenCreateForm('/products', draft);
    const missing = missingProductFields(draft);
    const submissionId = newSubmissionId();
    const opened =
      lang === 'ar' ? 'فتحت صفحة المنتجات ونموذج إضافة منتج.' : 'Opened Products and the Add product form.';
    if (missing.length > 0) {
      return {
        handled: true,
        text: `${opened}\n${askMissingProductField(missing[0]!, lang)}`,
        pending: { kind: 'createProduct', draft, submissionId },
        conversational: true,
      };
    }
    return {
      handled: true,
      text: `${opened}\n${formatProductPreview(draft, lang)}`,
      pending: { kind: 'createProduct', draft, submissionId },
      conversational: true,
    };
  }

  // --- Create customer / supplier / purchase: open page + real form (no finance) ---
  if (intent === 'createCustomer') {
    if (!(ctx.isOwner || ctx.can('canViewCustomers'))) {
      return {
        handled: true,
        text: lang === 'ar' ? 'ما عندك صلاحية تفتح الزبائن.' : 'You do not have permission to open Customers.',
        pending: null,
        conversational: true,
      };
    }
    return openPageCreateForm('/customers', { ...ctx, lang });
  }
  if (intent === 'createSupplier') {
    if (!(ctx.isOwner || ctx.can('canViewSuppliers'))) {
      return {
        handled: true,
        text: lang === 'ar' ? 'ما عندك صلاحية تفتح الموردين.' : 'You do not have permission to open Suppliers.',
        pending: null,
        conversational: true,
      };
    }
    return openPageCreateForm('/suppliers', { ...ctx, lang });
  }
  if (intent === 'createPurchase') {
    if (!(ctx.isOwner || ctx.can('canViewSuppliers'))) {
      return {
        handled: true,
        text: lang === 'ar' ? 'ما عندك صلاحية تفتح المشتريات.' : 'You do not have permission to open Purchases.',
        pending: null,
        conversational: true,
      };
    }
    return openPageCreateForm('/purchases', { ...ctx, lang });
  }

  // --- Cart add (execute only) ---
  if (intent === 'cartAdd' || isCartAddRequest(q)) {
    if (!(ctx.isOwner || ctx.can('canSell'))) {
      return {
        handled: true,
        text: lang === 'ar' ? 'ما عندك صلاحية البيع.' : 'You do not have permission to sell.',
        pending: null,
        conversational: true,
      };
    }
    if (!ctx.tenantId) {
      return { handled: true, text: lang === 'ar' ? 'ما في متجر مرتبط.' : 'No store is linked.', pending: null, conversational: true };
    }
    const quantity = parseCartQuantity(q, 1);
    const nameQuery = extractProductQuery(q) ?? q.replace(/\b(add|to|the|cart|ضيف|أضف|للسلة|عالسلة)\b/gi, ' ').trim();
    if (!nameQuery) {
      return {
        handled: true,
        text: lang === 'ar' ? 'أي منتج بدك تضيف؟' : 'Which product should I add?',
        pending,
        conversational: true,
      };
    }
    const matches = await searchProductsByName(ctx.tenantId, nameQuery);
    if (matches.length === 0) {
      return {
        handled: true,
        text: lang === 'ar' ? `ما لقيت منتج باسم «${nameQuery}».` : `No product found for “${nameQuery}”.`,
        pending: null,
        conversational: true,
      };
    }
    if (matches.length > 1) {
      const list = matches.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
      return {
        handled: true,
        text: (lang === 'ar' ? 'لقّيت أكثر من منتج. اختَر رقم:\n' : 'Several products match. Pick a number:\n') + list,
        pending: {
          kind: 'chooseProduct',
          purpose: 'cartAdd',
          quantity,
          matches: matches.map((p) => ({ id: p.id, name: p.name })),
          submissionId: newSubmissionId(),
        },
        conversational: true,
      };
    }
    const product = matches[0]!;
    return await confirmOrAddCart(product.id, product.name, quantity, lang, ctx, newSubmissionId());
  }

  // --- Cart remove one ---
  if (isCartRemoveRequest(q) && /\b(one|1|وحدة|واحدة)\b/i.test(q)) {
    if (!(ctx.isOwner || ctx.can('canSell'))) {
      return {
        handled: true,
        text: lang === 'ar' ? 'ما عندك صلاحية البيع.' : 'You do not have permission to sell.',
        pending: null,
        conversational: true,
      };
    }
    const host = getPosCartHost();
    if (!host) {
      ctx.navigate('/pos');
      return {
        handled: true,
        text: lang === 'ar' ? 'عم افتح نقطة البيع. بعدين قلّي شيل واحدة من أي منتج.' : 'Opening POS. Then tell me which product to remove one of.',
        pending: null,
        conversational: true,
      };
    }
    const cart = host.getCart();
    if (cart.lines.length === 0) {
      return { handled: true, text: lang === 'ar' ? 'السلة فاضية.' : 'The cart is empty.', pending: null, conversational: true };
    }
    if (cart.lines.length > 1 && !extractProductQuery(q)) {
      const list = cart.lines.map((line, i) => `${i + 1}. ${line.name} × ${line.quantity}`).join('\n');
      return {
        handled: true,
        text: (lang === 'ar' ? 'أي سطر؟\n' : 'Which line?\n') + list,
        pending: null,
        conversational: true,
      };
    }
    const line = cart.lines[cart.lines.length - 1]!;
    const result = cartRemoveOne(line.productId);
    if (!result.ok) {
      return { handled: true, text: lang === 'ar' ? 'ما قدرت عدّل السلة.' : 'Could not update the cart.', pending: null, conversational: true };
    }
    return {
      handled: true,
      text: lang === 'ar' ? `شلت واحدة من «${line.name}».` : `Removed one “${line.name}”.`,
      pending: null,
      conversational: true,
    };
  }

  // --- Short guides (fallback) ---
  const guide = shortGuideAnswer(q, lang);
  if (guide) {
    const card = matchGuide(q);
    const offerPath = card?.offerPath ?? guideOfferPath(q);
    const offer = offerPath
      ? buildNavigateOffer(offerPath, newSubmissionId(), { openCreateForm: Boolean(card?.openCreateForm) })
      : null;
    return { handled: true, text: guide, pending: offer, conversational: true };
  }

  return { handled: false, text: '', pending: null, conversational: false };
}

async function confirmOrAddCart(
  productId: string,
  productName: string,
  quantity: number,
  lang: AiLang,
  ctx: OperatorContext,
  submissionId: string,
): Promise<OperatorResult> {
  if (!getPosCartHost()) {
    ctx.navigate('/pos');
    return {
      handled: true,
      text:
        lang === 'ar'
          ? `عم افتح نقطة البيع. أكّد لإضافة «${productName}» × ${quantity} للسلة.`
          : `Opening POS. Confirm to add “${productName}” × ${quantity} to the cart.`,
      pending: { kind: 'cartAdd', productId, productName, quantity, submissionId },
      conversational: true,
    };
  }
  return executeCartAdd(productId, productName, quantity, lang, ctx);
}

async function executeCartAdd(
  productId: string,
  productName: string,
  quantity: number,
  lang: AiLang,
  ctx: OperatorContext,
): Promise<OperatorResult> {
  if (!ctx.tenantId) {
    return { handled: true, text: lang === 'ar' ? 'ما في متجر مرتبط.' : 'No store is linked.', pending: null, conversational: true };
  }
  const found = await getProductsByIds(ctx.tenantId, [productId]);
  const product = found[0];
  if (!product) {
    return {
      handled: true,
      text: lang === 'ar' ? `ما لقيت المنتج «${productName}».` : `Product “${productName}” was not found.`,
      pending: null,
      conversational: true,
    };
  }
  const result = cartAdd(product, quantity);
  if (!result.ok) {
    ctx.navigate('/pos');
    return {
      handled: true,
      text:
        lang === 'ar'
          ? `عم افتح نقطة البيع. أكّد لإضافة «${productName}» × ${quantity}.`
          : `Opening POS. Confirm to add “${productName}” × ${quantity}.`,
      pending: { kind: 'cartAdd', productId, productName, quantity, submissionId: newSubmissionId() },
      conversational: true,
    };
  }
  return {
    handled: true,
    text: lang === 'ar' ? `ضفت «${productName}» × ${quantity} للسلة.` : `Added “${productName}” × ${quantity} to the cart.`,
    pending: null,
    conversational: true,
  };
}
