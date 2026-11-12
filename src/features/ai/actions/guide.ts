import type { NavigateOfferPath } from './followUp';
import { isGuideIntent } from './operatorIntent';
import { isSubUserSelfGrantAiQuestion } from '../userFacingAnswer';

export type GuideTopic =
  | 'addProduct'
  | 'addCustomer'
  | 'addSupplier'
  | 'addPurchase'
  | 'supplierReturn'
  | 'return'
  | 'findProduct'
  | 'editProduct'
  | 'cartAdd'
  | 'discount'
  | 'cashVsCredit'
  | 'currencyTransfer'
  | 'importExport'
  | 'categories'
  | 'creditLimit'
  | 'collectDebt'
  | 'usersPermissions'
  | 'reports'
  | 'cashbox'
  | 'checkout'
  | 'sale';

interface GuideCard {
  topic: GuideTopic;
  pattern: RegExp;
  en: string;
  ar: string;
  /** Optional page the assistant may offer to open (never auto-opened from a guide). */
  offerPath?: NavigateOfferPath;
  /** Offer the page's Add/Create form (not pay/debt/cash). */
  openCreateForm?: boolean;
}

/** Numbered steps aligned with real UI labels across modules. */
const GUIDES: GuideCard[] = [
  {
    topic: 'findProduct',
    pattern: /find\s+(?:a\s+)?product|search\s+(?:for\s+)?(?:a\s+)?product|how\s+(?:do\s+i\s+)?(?:find|search)|دور\s*على\s*منتج|لاقي\s*منتج|ابحث\s*عن\s*منتج|كيف\s*(?:ب)?(?:لاقي|دور|ابحث)/i,
    offerPath: '/products',
    en: [
      'To find a product:',
      '',
      '1. Open the Products page (or Point of sale for selling).',
      '2. Use the search box — type the name or scan/enter the barcode.',
      '3. Optionally filter by category.',
      '',
      'I can open Products for you if you want.',
    ].join('\n'),
    ar: [
      'لتلاقي منتج:',
      '',
      '1. افتح صفحة المنتجات (أو نقطة البيع للبيع).',
      '2. استخدم خانة البحث — اكتب الاسم أو الباركود.',
      '3. فيك تفلتر حسب الفئة.',
      '',
      'فيني افتحلك المنتجات إذا بتحب.',
    ].join('\n'),
  },
  {
    topic: 'editProduct',
    pattern: /edit\s+(?:a\s+)?product|update\s+(?:a\s+)?product|change\s+(?:a\s+)?product|عدّل\s*منتج|عدل\s*منتج|تعديل\s*منتج|كيف\s*(?:ب)?عدّ?ل\s*منتج/i,
    offerPath: '/products',
    en: [
      'To edit a product:',
      '',
      '1. Open the Products page.',
      '2. Find the product (search or browse).',
      '3. Open it and change the fields you need.',
      '4. Save from that screen.',
      '',
      'I can open Products for you if you want. I will not save edits from chat.',
    ].join('\n'),
    ar: [
      'لتعديل منتج:',
      '',
      '1. افتح صفحة المنتجات.',
      '2. لاقي المنتج (بحث أو تصفّح).',
      '3. افتحه وعدّل الحقول.',
      '4. احفظ من الشاشة.',
      '',
      'فيني افتحلك المنتجات إذا بتحب. ما بحفظ التعديل من الدردشة.',
    ].join('\n'),
  },
  {
    topic: 'cartAdd',
    pattern: /add\s+.+\s+to\s+(?:the\s+)?cart|put\s+.+\s+(?:in|on)\s+(?:the\s+)?cart|add\s+(?:a\s+)?product\s+to\s+(?:the\s+)?cart|حط(?:لي)?\s*.*(?:بالسلة|للسلة|بالكارت)|ضيف(?:لي)?\s*.*(?:بالسلة|للسلة|بالكارت)/i,
    offerPath: '/pos',
    en: [
      'To add an existing product to the cart (not creating a new catalog product):',
      '',
      '1. Open Point of sale.',
      '2. Search or scan the product.',
      '3. Tap it (or set quantity) so it joins the cart.',
      '4. Review the cart, then checkout yourself when ready.',
      '',
      'I can open POS for you if you want. Say the product name if you want me to prepare a cart line.',
    ].join('\n'),
    ar: [
      'لإضافة منتج موجود للسلة (مش إنشاء منتج جديد بالكتالوج):',
      '',
      '1. افتح نقطة البيع.',
      '2. ابحث أو امسح المنتج.',
      '3. اضغط عليه (أو حدّد الكمية) لينضاف للسلة.',
      '4. راجع السلة، والدفع منك من الشاشة.',
      '',
      'فيني افتحلك نقطة البيع إذا بتحب. إذا بدك حضّر سطر بالسلة، قول اسم المنتج.',
    ].join('\n'),
  },
  {
    topic: 'addProduct',
    // Do not match "add product to cart" — that is cart intent, not catalog create.
    pattern: /(?:add|create|register)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:product|item|sku)(?!\s+to\s+(?:the\s+)?cart)|new\s+(?:product|item|sku)|ضيف\s*(?:منتج|صنف|غرض)(?!\s*(?:للسلة|بالسلة|للكارت))|بضيف\s*(?:منتج|صنف)|أضف\s*(?:منتج|صنف|غرض)(?!\s*(?:للسلة|بالسلة))|إضافة\s*(?:منتج|صنف)|اضافة\s*(?:منتج|صنف)|منتج\s*جديد|صنف\s*جديد/i,
    offerPath: '/products',
    openCreateForm: true,
    en: [
      'To add a new product:',
      '',
      '1. Open the Products page.',
      '2. Tap Add product.',
      '3. Enter the product name.',
      '4. Enter the selling price (and cost if you use it).',
      '5. Add barcode, category, and stock as needed.',
      '6. Review the details and save.',
      '',
      'I can open Products and the Add product form for you if you want.',
    ].join('\n'),
    ar: [
      'لإضافة منتج جديد:',
      '',
      '1. افتح صفحة المنتجات.',
      '2. اضغط على إضافة منتج.',
      '3. اكتب اسم المنتج.',
      '4. أدخل سعر البيع وسعر الكلفة إذا كان مطلوباً.',
      '5. أدخل الباركود والتصنيف والكمية حسب الحاجة.',
      '6. راجع المعلومات واحفظ المنتج.',
      '',
      'إذا بتحب، فيني افتحلك صفحة المنتجات ونموذج إضافة منتج.',
    ].join('\n'),
  },
  {
    topic: 'addCustomer',
    pattern: /add\s+(?:a\s+|an\s+)?(?:customer|client)|create\s+(?:a\s+|an\s+)?(?:customer|client)|new\s+(?:customer|client)|ضيف\s*(?:زبون|عميل)|بضيف\s*(?:زبون|عميل)|أضف\s*(?:زبون|عميل)|إضافة\s*(?:زبون|عميل)|اضافة\s*(?:زبون|عميل)|زبون\s*جديد|عميل\s*جديد/i,
    offerPath: '/customers',
    openCreateForm: true,
    en: [
      'To add a customer:',
      '',
      '1. Open Customers.',
      '2. Tap Add customer.',
      '3. Enter the name (and phone/email if you have them).',
      '4. Set credit limit if needed.',
      '5. Save.',
      '',
      'I can open Customers and the Add customer form if you want.',
    ].join('\n'),
    ar: [
      'لإضافة زبون:',
      '',
      '1. افتح صفحة الزبائن.',
      '2. اضغط إضافة زبون.',
      '3. اكتب الاسم (والهاتف أو الإيميل إذا عندك).',
      '4. حدّد سقف الدين إذا لزم.',
      '5. احفظ.',
      '',
      'إذا بتحب، فيني افتحلك صفحة الزبائن ونموذج إضافة زبون.',
    ].join('\n'),
  },
  {
    topic: 'addSupplier',
    pattern: /add\s+(?:a\s+|an\s+)?(?:supplier|vendor)|create\s+(?:a\s+|an\s+)?(?:supplier|vendor)|new\s+(?:supplier|vendor)|ضيف\s*مورد|بضيف\s*مورد|أضف\s*مورد|إضافة\s*مورد|اضافة\s*مورد|مورد\s*جديد/i,
    offerPath: '/suppliers',
    openCreateForm: true,
    en: [
      'To add a supplier:',
      '',
      '1. Open Suppliers.',
      '2. Tap Add supplier.',
      '3. Enter the name and contact details.',
      '4. Save.',
      '',
      'I can open Suppliers and the Add supplier form if you want.',
    ].join('\n'),
    ar: [
      'لإضافة مورد:',
      '',
      '1. افتح صفحة الموردين.',
      '2. اضغط إضافة مورد.',
      '3. اكتب الاسم ومعلومات التواصل.',
      '4. احفظ.',
      '',
      'إذا بتحب، فيني افتحلك صفحة الموردين ونموذج إضافة مورد.',
    ].join('\n'),
  },
  {
    topic: 'addPurchase',
    pattern:
      /add\s+(?:a\s+)?purchase|new\s+purchase|create\s+(?:a\s+)?purchase|purchase\s+(?:bill|invoice)|ضيف\s*(?:شراء|فاتورة\s*شراء)|بضيف\s*شراء|فاتورة\s*شراء\s*جديدة|إضافة\s*شراء|اضافة\s*شراء|مشتريات\s*جديدة/i,
    offerPath: '/purchases',
    openCreateForm: true,
    en: [
      'To create a purchase bill:',
      '',
      '1. Open Purchases.',
      '2. Tap New purchase.',
      '3. Choose the supplier and add line items.',
      '4. Review totals and save the bill.',
      '',
      'I can open Purchases and the New purchase form if you want. Paying the supplier stays on that screen.',
    ].join('\n'),
    ar: [
      'لإنشاء فاتورة شراء:',
      '',
      '1. افتح صفحة المشتريات.',
      '2. اضغط فاتورة شراء جديدة.',
      '3. اختَر المورد وضيف الأصناف.',
      '4. راجع الإجمالي واحفظ الفاتورة.',
      '',
      'إذا بتحب، فيني افتحلك المشتريات ونموذج الفاتورة. دفع المورد بيصير من الشاشة.',
    ].join('\n'),
  },
  {
    topic: 'supplierReturn',
    pattern: /supplier\s+return|return\s+(?:\w+\s+){0,4}to\s+(?:the\s+)?supplier|purchase\s+return|return\s+goods|مرتجع\s*(?:ال)?مورد|ارجاع\s*(?:لل)?مورد|إرجاع\s*(?:لل)?مورد/i,
    offerPath: '/purchases',
    en: [
      'Supplier returns are handled from Purchases — not the customer Sales return flow.',
      '',
      '1. Open Purchases.',
      '2. Find the purchase bill tied to that supplier.',
      '3. Use the return / adjustment controls on that screen for the lines you need.',
      '4. Confirm on that screen (this chat will not post a supplier return).',
      '',
      'I can open Purchases for you if you want. Customer returns stay under Sales.',
    ].join('\n'),
    ar: [
      'مرتجع المورد من المشتريات — مش من مرتجع الزبون بالمبيعات.',
      '',
      '1. افتح المشتريات.',
      '2. لاقي فاتورة الشراء لهالمورد.',
      '3. استخدم مرتجع/تعديل الأصناف من هالشاشة.',
      '4. أكّد من الشاشة (هالدردشة ما بتنفّذ مرتجع مورد).',
      '',
      'فيني افتحلك المشتريات إذا بتحب. مرتجع الزبون بيبقى تحت المبيعات.',
    ].join('\n'),
  },
  {
    topic: 'return',
    pattern: /return|refund|مرتجع|ارجاع|إرجاع/i,
    offerPath: '/sales',
    en: [
      'To process a customer return:',
      '',
      '1. Open Sales.',
      '2. Find the invoice.',
      '3. Open it and choose Return.',
      '4. Select the items and quantities to return.',
      '5. Confirm the return in that screen (this chat will not complete it).',
      '',
      'I can open Sales for you if you want.',
    ].join('\n'),
    ar: [
      'لعمل مرتجع زبون:',
      '',
      '1. افتح المبيعات.',
      '2. لاقي الفاتورة.',
      '3. افتحها واختر مرتجع.',
      '4. حدّد الأصناف والكميات.',
      '5. أكّد المرتجع من هالشاشة (هالدردشة ما بتنفّذ المرتجع).',
      '',
      'فيني افتحلك المبيعات إذا بتحب.',
    ].join('\n'),
  },
  {
    topic: 'discount',
    pattern: /discounts?|line\s+price|edit\s+(?:a\s+)?(?:line\s+)?price|خصم|تخفيض|سعر\s*السطر/i,
    offerPath: '/pos',
    en: [
      'How discounts work in a sale:',
      '',
      '1. Open Point of sale and add products to the cart.',
      '2. There is no whole-cart coupon in this POS.',
      '3. If your role allows editing line prices, open a cart line and change its unit price — that acts as a line discount.',
      '4. Review the cart totals, then complete checkout yourself on screen.',
      '',
      'I can open POS for you if you want. I will not apply or change prices from chat.',
    ].join('\n'),
    ar: [
      'كيف بيشتغل الخصم بالبيع:',
      '',
      '1. افتح نقطة البيع وضيف الأصناف للسلة.',
      '2. ما في قسيمة خصم على كامل السلة بهالنظام.',
      '3. إذا صلاحيتك بتسمح تعديل سعر السطر، افتح سطر بالسلة وعدّل سعر الوحدة — هيدا بيظهر كخصم سطر.',
      '4. راجع الإجمالي وأكمل الدفع من الشاشة.',
      '',
      'فيني افتحلك نقطة البيع إذا بتحب. ما بطبّق خصم ولا بعدّل أسعار من الدردشة.',
    ].join('\n'),
  },
  {
    topic: 'cashVsCredit',
    pattern: /cash\s+and\s+credit|credit\s+and\s+cash|cash\s+vs\.?\s+credit|credit\s+vs\.?\s+cash|difference\s+between\s+cash|نقد\s*(?:و|وال)?\s*دين|دين\s*(?:و|وال)?\s*نقد|فرق\s*بين.{0,40}(?:كاش|نقد|دين)|(?:ال)?(?:كاش|نقد(?:اً)?).{0,20}(?:ال)?دين|(?:ال)?دين.{0,20}(?:ال)?(?:كاش|نقد)/i,
    offerPath: '/pos',
    en: [
      'Cash vs credit sales:',
      '',
      '1. Both start the same: open Point of sale, add products, set quantities.',
      '2. Cash sale: at checkout choose cash, enter USD/LBP received, confirm change. Money goes to the drawer when the sale completes.',
      '3. Credit sale: attach a customer (required), choose credit, enter any amount paid now. The unpaid remainder becomes customer debt.',
      '4. Completing either type happens on the checkout screen — not from this chat.',
      '',
      'I can open POS for you if you want. Ask separately if you need today’s cash or debt figures.',
    ].join('\n'),
    ar: [
      'الفرق بين البيع نقداً والبيع بالدين:',
      '',
      '1. الاتنين بيبلّشوا نفس الشي: نقطة البيع، ضيف الأصناف، حدّد الكميات.',
      '2. نقداً: عند الدفع اختَر نقد، أدخل المبالغ المستلمة بالدولار/الليرة، وأكّد الباقي. الفلوس بتروح للصندوق عند نجاح البيع.',
      '3. دين: لازم تختار زبون، اختَر دين، وأدخل أي مبلغ مدفوع هلأ. الباقي بيصير دين على الزبون.',
      '4. الإتمام من شاشة الدفع — مش من الدردشة.',
      '',
      'فيني افتحلك نقطة البيع إذا بتحب. إذا بدك أرقام الصندوق أو الديون اليوم، اسأل بصراحة.',
    ].join('\n'),
  },
  {
    topic: 'currencyTransfer',
    pattern: /(?:cash\s+)?transfers?\s+between|transfer(?:s)?\s+(?:usd|lbp|currency)|usd\s*(?:\/|and|to|↔|⇄)\s*lbp|lbp\s*(?:\/|and|to)\s*usd|تحويل\s*(?:بين|من)|صرف\s*(?:دولار|ليرة)|بين\s*(?:ال)?دولار\s*(?:و|وال)\s*(?:ال)?ليرة/i,
    offerPath: '/cashbox',
    en: [
      'USD and LBP in the cash drawer:',
      '',
      '1. The drawer keeps USD and LBP as separate balances — they are not mixed automatically.',
      '2. Cashbox can show a combined display figure using your store exchange rate for reading only.',
      '3. There is no “transfer USD ↔ LBP” action in chat, and this assistant will not move money between currencies.',
      '4. Record cash in/out (and expenses) yourself on the Cashbox screen when you need a real movement.',
      '',
      'I can open Cashbox for you if you want. I will not execute a currency transfer.',
    ].join('\n'),
    ar: [
      'الدولار والليرة بالصندوق:',
      '',
      '1. أرصدة الدولار والليرة منفصلة — ما بيتخلطوا تلقائياً.',
      '2. صفحة الصندوق ممكن تعرض رقم موحّد للعرض حسب سعر الصرف بالقراءات فقط.',
      '3. ما في عملية «تحويل دولار ↔ ليرة» من الدردشة، وهالمساعد ما بحرك فلوس بين العملات.',
      '4. سجّل إدخال/إخراج نقد (والمصروف) من شاشة الصندوق بنفسك عند الحاجة.',
      '',
      'فيني افتحلك الصندوق إذا بتحب. ما بنفّذ تحويل عملة.',
    ].join('\n'),
  },
  {
    topic: 'importExport',
    pattern:
      /\bimport\b|\bexport\b|csv|استيراد|تصدير|ملف\s*csv|كيف\s*(?:ب)?(?:استورد|صدر|صدّر)/i,
    offerPath: '/products',
    en: [
      'Product import and export (CSV) live on the Products page.',
      '',
      'Import:',
      '1. Open Products (needs product viewing access).',
      '2. Tap Import (needs the Import products permission).',
      '3. Choose a .csv file. Columns supported: name, barcode, category, retail, wholesale, vip, retail_lbp, cost, stock, min_stock, expiry_date.',
      '4. Review the ready count, then confirm import in that dialog.',
      '',
      'Export:',
      '1. On Products, tap Export CSV (needs the Export products permission).',
      '2. The file downloads for the products currently loaded/visible on the page — not a separate “whole catalog” export screen.',
      '3. Cost columns appear only if your role can view costs.',
      '',
      'I can open Products for you if you want. I will not upload or download files from chat.',
    ].join('\n'),
    ar: [
      'استيراد وتصدير المنتجات (CSV) من صفحة المنتجات.',
      '',
      'الاستيراد:',
      '1. افتح المنتجات (يلزم صلاحية عرض المنتجات).',
      '2. اضغط استيراد (يلزم صلاحية استيراد المنتجات).',
      '3. اختَر ملف .csv. الأعمدة المدعومة: name, barcode, category, retail, wholesale, vip, retail_lbp, cost, stock, min_stock, expiry_date.',
      '4. راجع عدد المنتجات الجاهزة وأكّد الاستيراد من نفس النافذة.',
      '',
      'التصدير:',
      '1. من المنتجات اضغط تصدير CSV (يلزم صلاحية تصدير المنتجات).',
      '2. الملف بينزل للمنتجات الظاهرة/المحمّلة حالياً بالصفحة — مش شاشة تصدير لكل الكتالوج.',
      '3. أعمدة الكلفة بتظهر فقط إذا صلاحيتك بتسمح عرض الكلفة.',
      '',
      'فيني افتحلك المنتجات إذا بتحب. ما برفع ولا بنزّل ملفات من الدردشة.',
    ].join('\n'),
  },
  {
    topic: 'categories',
    pattern:
      /\bcategor(?:y|ies)\b|تصنيف|التصنيفات|فئات\s*المنتج|كيف\s*(?:ب)?(?:ضيف|عدّل|ادير)\s*تصنيف/i,
    offerPath: '/products',
    en: [
      'Product categories are managed on the Products page (there is no separate Categories page).',
      '',
      '1. Open Products.',
      '2. Tap Categories (needs product editing access).',
      '3. Add a new category name, or Edit / Save / Delete an existing one.',
      '4. Delete is blocked if products still use that category.',
      '5. Assign a category on a product form (you can also pick “Add new category” there).',
      '6. Use the category filter on Products (and on Point of sale) to browse by category.',
      '',
      'I can open Products for you if you want.',
    ].join('\n'),
    ar: [
      'تصنيفات المنتجات بتتنظّم من صفحة المنتجات (ما في صفحة تصنيفات منفصلة).',
      '',
      '1. افتح المنتجات.',
      '2. اضغط التصنيفات (يلزم صلاحية تعديل المنتجات).',
      '3. ضيف اسم تصنيف جديد، أو عدّل / احفظ / احذف تصنيف موجود.',
      '4. الحذف بينرفض إذا في منتجات لساتها على هالتصنيف.',
      '5. عيّن التصنيف من نموذج المنتج (فيك كمان تختار «إضافة تصنيف جديد»).',
      '6. استخدم فلتر التصنيف بالمنتجات (وبنقطة البيع) للتصفّح حسب التصنيف.',
      '',
      'فيني افتحلك المنتجات إذا بتحب.',
    ].join('\n'),
  },
  {
    topic: 'creditLimit',
    pattern:
      /credit\s*limits?|customer\s+limit|سقف\s*الدين|حد\s*الدين|سقف\s*ائتمان|كيف\s*(?:ب)?(?:حط|حدد|ضبط)\s*سقف/i,
    offerPath: '/customers',
    en: [
      'Customer credit limits control how much unpaid debt a customer may carry on credit sales.',
      '',
      '1. Open Customers (needs customer viewing access).',
      '2. Add a customer or open an existing one to edit.',
      '3. Set Credit limit ($) on the form, then save.',
      '4. On a credit sale in Point of sale, attach that customer; checkout blocks the sale if it would exceed the limit.',
      '5. The Customers list can highlight when current debt is over the limit.',
      '',
      'Default for a brand-new customer is $500 unless you change it. Debt payment and limit edits stay on-screen — this chat will not change balances.',
      '',
      'I can open Customers for you if you want.',
    ].join('\n'),
    ar: [
      'سقف دين الزبون بيحدّد قديش دين مسموح يفوت على مبيعات الدين.',
      '',
      '1. افتح الزبائن (يلزم صلاحية عرض الزبائن).',
      '2. ضيف زبون أو افتح زبون موجود للتعديل.',
      '3. حدّد سقف الدين ($) بالنموذج واحفظ.',
      '4. ببيع الدين من نقطة البيع اختَر هالزبون؛ الدفع بيمنع البيع إذا تجاوز السقف.',
      '5. قائمة الزبائن ممكن تلوّن لما الدين الحالي يفوت السقف.',
      '',
      'الافتراضي لزبون جديد هو 500$ إلا إذا غيّرته. تسديد الدين وتعديل السقف من الشاشة — هالدردشة ما بتغيّر أرصدة.',
      '',
      'فيني افتحلك الزبائن إذا بتحب.',
    ].join('\n'),
  },
  {
    topic: 'collectDebt',
    pattern:
      /(?:how\s+(?:do|to).{0,40})?(?:collect|record|receive)\s+(?:a\s+|the\s+)?(?:customer\s+)?debt(?:\s+payment)?|record\s+(?:a\s+)?(?:debt\s+)?payment|receive\s+payment|كيف\s*(?:ب)?(?:ستلم|سدد|حصّل).{0,24}دين|تسديد\s*(?:ال)?دين|استلام\s*(?:دفعة|دين)|كيف\s*(?:ب)?سجل\s*(?:دفعة|دين)/i,
    offerPath: '/customers',
    en: [
      'To record a customer debt payment on screen:',
      '',
      '1. Open Customers (needs Customers & debts access).',
      '2. Find the customer who owes money.',
      '3. Open Receive payment for that customer.',
      '4. Enter the amount paid (USD and/or LBP) and save on that screen.',
      '',
      'I can open Customers for you if you want. I will not collect or change debt from chat.',
    ].join('\n'),
    ar: [
      'لاستلام دفعة دين من زبون على الشاشة:',
      '',
      '1. افتح الزبائن (يلزم صلاحية الزبائن والديون).',
      '2. لاقي الزبون اللي عليه دين.',
      '3. افتح استلام دفعة لهالزبون.',
      '4. أدخل المبلغ المدفوع (دولار و/أو ليرة) واحفظ من نفس الشاشة.',
      '',
      'فيني افتحلك الزبائن إذا بدك. ما بستلم ولا بغيّر دين من الدردشة.',
    ].join('\n'),
  },
  {
    topic: 'usersPermissions',
    pattern:
      /\broles?\b|sub[- ]?users?|staff\s+(?:accounts?|users?)|manage\s+users?|user\s+permissions?|add\s+(?:a\s+)?(?:staff|user)\b|edit\s+(?:a\s+)?sub[- ]?user|صلاحيات\s*(?:ال)?(?:مستخدم|موظف|مالك)|مستخدم(?:ين)?|موظف(?:ين)?|أدوار|كيف\s*(?:ب)?(?:ضيف|عدّل)\s*مستخدم|من\s*(?:بي)?دير\s*المستخدم/i,
    offerPath: '/users',
    en: [
      'Owners and staff permissions:',
      '',
      '1. The store owner implicitly has every permission.',
      '2. Only the owner can open Users and create, edit, or delete staff accounts.',
      '3. On Users, tap Add user (or Edit user), set the account active, and tick the permissions they need — grouped under Products, Sales, and Management.',
      '4. Staff never manage the Users page themselves; the owner assigns access (including Access Zelvero AI).',
      '5. The UI may hide screens without access; the server still enforces permissions.',
      '',
      'I can open Users for you if you are the owner. I cannot grant or change permissions from chat.',
    ].join('\n'),
    ar: [
      'صلاحيات المالك والموظفين:',
      '',
      '1. المالك يملك كل الصلاحيات ضمنياً.',
      '2. المالك وحده بيفتح المستخدمين وبيقدر يضيف أو يعدّل أو يحذف حسابات الموظفين.',
      '3. من المستخدمين اضغط إضافة مستخدم (أو تعديل)، فعّل الحساب، وعلّم الصلاحيات المطلوبة — مجموعات المنتجات والمبيعات والإدارة.',
      '4. الموظف ما بيدير صفحة المستخدمين؛ المالك بيعطي الوصول (ومنها الوصول إلى Zelvero AI).',
      '5. الواجهة ممكن تخفي شاشات بلا صلاحية؛ والخادم بيطبّق الصلاحيات.',
      '',
      'فيني افتحلك المستخدمين إذا أنت المالك. ما بقدر أمنح أو أغيّر صلاحيات من الدردشة.',
    ].join('\n'),
  },
  {
    topic: 'reports',
    pattern:
      /\breports?\b|\bdate\s+range\b|تقارير|التقارير|الأرباح|كيف\s*(?:ب)?(?:شوف|فتح)\s*تقرير|(?:\banalytics?\b|\bprofit\b)(?![^.]*\b(?:shopify|loyalty|woocommerce)\b)/i,
    offerPath: '/reports',
    en: [
      'Reports on the Reports page (needs reports viewing access):',
      '',
      '1. Open Reports.',
      '2. Use the date range control (today, yesterday, week, month, last month, year, or custom from/to) on tabs that need a period.',
      '3. Tabs: Sales, Profit (also needs cost viewing), Inventory, Customers, Capital (also needs cost viewing), Expenses.',
      '4. Sales shows net / cash / credit / returns / discount and a daily table; you can export CSV for the visible sales view.',
      '5. Profit shows sales, cost of goods, gross profit, expenses, and net profit for the range.',
      '6. Inventory and Customers show counts and debtors; some stock/capital values may show as unavailable.',
      '7. Expenses lists cashbox expense movements for the range.',
      '',
      'Rankings by category/cashier/top products are not available on this page yet. Ask for today’s sales or cash figures separately if you want live numbers.',
      '',
      'I can open Reports for you if you want. I will not invent missing report types.',
    ].join('\n'),
    ar: [
      'التقارير من صفحة التقارير (يلزم صلاحية عرض التقارير):',
      '',
      '1. افتح التقارير.',
      '2. استخدم نطاق التاريخ (اليوم، أمس، أسبوع، شهر، الشهر الماضي، سنة، أو من–إلى مخصّص) بالتبويبات اللي بتحتاج فترة.',
      '3. التبويبات: المبيعات، الأرباح (وتعرض الكلفة)، المخزون، الزبائن، رأس المال (وتعرض الكلفة)، المصاريف.',
      '4. المبيعات: صافي / نقد / دين / مرتجعات / خصم وجدول يومي؛ فيك تصدّر CSV للعرض الظاهر.',
      '5. الأرباح: مبيعات، كلفة البضاعة، ربح إجمالي، مصاريف، وصافي ربح للفترة.',
      '6. المخزون والزبائن: أعداد والمدينين؛ بعض قيم المخزون/رأس المال ممكن تظهر غير متاحة.',
      '7. المصاريف: حركات مصروف الصندوق ضمن الفترة.',
      '',
      'ترتيب حسب التصنيف/الكاشير/أكثر المنتجات مش متاح بهالصفحة بعد. إذا بدك أرقام اليوم الحية، اسأل عنها بوضوح.',
      '',
      'فيني افتحلك التقارير إذا بتحب. ما بخترع تقارير ناقصة.',
    ].join('\n'),
  },
  {
    topic: 'cashbox',
    pattern: /cash\s*box|cashbox|cash\s*drawer|expense|مصروف|المصاريف|الصندوق|الدرج/i,
    offerPath: '/cashbox',
    en: [
      'To work with the cash drawer (including an Expense move):',
      '',
      '1. Open Cashbox.',
      '2. Review the drawer balances.',
      '3. Use the on-screen cash in/out controls — Expense is one of those moves — yourself when you need a movement.',
      '',
      'I can open Cashbox for you if you want. I will not move money from chat.',
    ].join('\n'),
    ar: [
      'للتعامل مع الصندوق (ومنه مصروف):',
      '',
      '1. افتح الصندوق.',
      '2. راجع أرصدة الدرج.',
      '3. استخدم إدخال/إخراج النقد من الشاشة — المصروف حركة من هون — بنفسك عند الحاجة.',
      '',
      'فيني افتحلك الصندوق إذا بتحب. ما بحرك فلوس من الدردشة.',
    ].join('\n'),
  },
  {
    topic: 'checkout',
    pattern: /checkout|complete\s+(?:the\s+)?sale|تمم\s*البيع|أكمل\s*البيع|ادفع/i,
    offerPath: '/pos',
    en: [
      'To finish a sale:',
      '',
      '1. Open Point of sale.',
      '2. Add products to the cart.',
      '3. Review quantities and the customer if needed.',
      '4. Use Checkout in the cart panel and complete payment yourself.',
      '',
      'I can open POS for you if you want. I will not confirm payment from chat.',
    ].join('\n'),
    ar: [
      'لإتمام عملية بيع:',
      '',
      '1. افتح نقطة البيع.',
      '2. ضيف الأصناف للسلة.',
      '3. راجع الكميات والزبون إذا لزم.',
      '4. استخدم الدفع من لوحة السلة وأكمل الدفع بنفسك.',
      '',
      'فيني افتحلك نقطة البيع إذا بتحب. ما بأكّد الدفع من الدردشة.',
    ].join('\n'),
  },
  {
    topic: 'sale',
    pattern: /process(?:ing)?\s+(?:a\s+|the\s+)?sale|\bmake\s+a\s+sale\b|كيف\s*ببيع|طريقة\s*البيع/i,
    offerPath: '/pos',
    en: [
      'To make a sale:',
      '',
      '1. Open Point of sale.',
      '2. Find products and add them to the cart.',
      '3. Set quantities.',
      '4. Optionally choose a customer (required for credit).',
      '5. Open Checkout and complete payment in the app.',
      '',
      'I can open POS for you if you want.',
    ].join('\n'),
    ar: [
      'لعمل عملية بيع:',
      '',
      '1. افتح نقطة البيع.',
      '2. لاقي المنتجات وضيفها للسلة.',
      '3. حدّد الكميات.',
      '4. اختَر زبون إذا لزم (إلزامي للدين).',
      '5. افتح الدفع وأكمل من التطبيق.',
      '',
      'فيني افتحلك نقطة البيع إذا بتحب.',
    ].join('\n'),
  },
];

const PRIORITY_GUIDE_TOPICS = [
  'discount',
  'cashVsCredit',
  'currencyTransfer',
  'supplierReturn',
  'importExport',
  'categories',
  'creditLimit',
  'collectDebt',
  'usersPermissions',
  'reports',
] as const;

export function matchGuide(question: string): GuideCard | null {
  const q = question.trim();
  // Self-grant policy answers come from userFacingAnswer — never the Users how-to.
  if (isSubUserSelfGrantAiQuestion(q)) return null;
  // Topic explainers can match without a classic "how do I" opener.
  const topical =
    /discounts?|cash\s+and\s+credit|cash\s+vs|difference\s+between|transfers?\s+between|usd.*lbp|خصم|فرق|تحويل\s*بين|نقد.*دين|دين.*نقد|\bimport\b|\bexport\b|csv|استيراد|تصدير|\bcategor(?:y|ies)\b|تصنيف|credit\s*limits?|سقف\s*الدين|collect\s+debt|record\s+(?:a\s+)?(?:debt\s+)?payment|ستلم\s*دين|تسديد|\broles?\b|sub[- ]?user|user\s+permissions?|manage\s+users?|صلاحيات\s*(?:ال)?(?:مستخدم|موظف)|مستخدم(?:ين)?|\breports?\b|\banalytics?\b|تقارير|تقرير/i.test(
      q,
    );
  if (
    !isGuideIntent(question) &&
    !topical &&
    !/how\s+(?:do|to)|كيف|علّ?مني|طريقة|ورجيني\s*وين|فرجيني\s*وين|شو\s*الفرق|ما\s*الفرق|وين\s*(?:التقارير|التصنيف)/i.test(question)
  ) {
    return null;
  }
  // Do not answer unavailable third-party analytics with the Reports guide.
  if (/\bshopify\b|\bloyalty\b|\bwoocommerce\b|برنامج\s*ولاء/i.test(q)) return null;

  for (const topic of PRIORITY_GUIDE_TOPICS) {
    const card = GUIDES.find((entry) => entry.topic === topic);
    if (card && card.pattern.test(q)) return card;
  }

  for (const card of GUIDES) {
    if ((PRIORITY_GUIDE_TOPICS as readonly string[]).includes(card.topic)) continue;
    if (card.topic === 'addProduct' && /cart|سلة|كارت/i.test(q)) continue;
    if (card.topic === 'return' && /supplier|مورد|purchase\s+return/i.test(q)) continue;
    // Cashbox how-to must not swallow transfer / reports / credit explainers.
    if (card.topic === 'cashbox' && /transfer|usd|lbp|credit\s+sales?|vs\.?\s+credit|فرق|تحويل|reports?|تقرير/i.test(q)) {
      continue;
    }
    // addCustomer must not beat a dedicated credit-limit or debt-collection question.
    if (card.topic === 'addCustomer' && /credit\s*limit|سقف\s*الدين|collect|ستلم|سدد|دين/i.test(q)) continue;
    if (card.pattern.test(q)) return card;
  }
  return null;
}

export function shortGuideAnswer(question: string, lang: 'ar' | 'en'): string | null {
  const guide = matchGuide(question);
  if (!guide) return null;
  return lang === 'ar' ? guide.ar : guide.en;
}

export function guideOfferPath(question: string): GuideCard['offerPath'] | null {
  return matchGuide(question)?.offerPath ?? null;
}
