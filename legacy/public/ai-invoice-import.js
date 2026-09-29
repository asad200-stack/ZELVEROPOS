/**
 * AI Invoice Import — TEST only.
 * Extracts line items from supplier invoice images for user review before saving.
 */
(function () {
    'use strict';

    var state = {
        imageFile: null,
        imageBase64: '',
        mimeType: 'image/jpeg',
        rows: [],
        invoiceMeta: {
            invoiceNumber: '',
            invoiceDate: '',
            supplierName: '',
            currency: 'USD',
            notes: ''
        },
        bound: false
    };

    function isTestEnv() {
        return !!(window.__APP_ENV_IS_TEST || (window.__APP_BUILD_META && window.__APP_BUILD_META.env === 'test'));
    }

    function isEn() {
        return (document.documentElement.lang || 'ar') === 'en';
    }

    function txt(en, ar) {
        return isEn() ? en : ar;
    }

    function getExchangeRate() {
        try {
            var rate = Number(window.settings && window.settings.exchangeRate);
            return Number.isFinite(rate) && rate > 0 ? rate : 89500;
        } catch (_) {
            return 89500;
        }
    }

    function getProducts() {
        return Array.isArray(window.products) ? window.products : [];
    }

    function getSuppliers() {
        return Array.isArray(window.suppliers) ? window.suppliers : [];
    }

    function $(id) {
        return document.getElementById(id);
    }

    function showImportButtonIfTest() {
        var btn = $('aiInvoiceImportBtn');
        if (!btn) return;
        var canUse = false;
        try {
            canUse = typeof hasProductPermission === 'function' &&
                (hasProductPermission('canAddProducts') || hasProductPermission('canImportProducts'));
        } catch (_) {}
        btn.style.display = (isTestEnv() && canUse) ? '' : 'none';
    }

    function formatRate(rate) {
        return Number(rate).toLocaleString(isEn() ? 'en-US' : 'ar-LB') + ' LBP';
    }

    function round2(n) {
        return Math.round(Number(n || 0) * 100) / 100;
    }

    function roundLbp(n) {
        return Math.round(Number(n || 0));
    }

    function readFileAsDataUrl(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(String(reader.result || '')); };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function dataUrlToBase64(dataUrl) {
        var idx = String(dataUrl).indexOf(',');
        return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
    }

    function normalizeExpiry(val) {
        if (!val) return '';
        var s = String(val).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        var m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (m) {
            return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
        }
        m = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
        if (m) return m[2] + '-' + String(m[1]).padStart(2, '0') + '-28';
        return '';
    }

    function applyCurrencyToRow(row, rate) {
        var cur = String(row.invoiceCurrency || 'USD').toUpperCase();
        var unit = Number(row.rawUnitCost || 0);
        if (!(unit > 0)) {
            row.unitCostUSD = Number(row.unitCostUSD) || 0;
            row.unitCostLBP = Number(row.unitCostLBP) || 0;
        } else if (cur === 'LBP') {
            row.unitCostLBP = roundLbp(unit);
            row.unitCostUSD = round2(unit / rate);
        } else {
            row.unitCostUSD = round2(unit);
            row.unitCostLBP = roundLbp(unit * rate);
        }
        var qty = Math.max(0, Number(row.quantity) || 0);
        row.totalUSD = round2((row.unitCostUSD || 0) * qty);
        row.totalLBP = roundLbp((row.unitCostLBP || 0) * qty);
    }

    function suggestProductMatch(name, barcode) {
        var list = getProducts();
        if (barcode && typeof normalizeProductBarcode === 'function' && typeof findProductWithBarcode === 'function') {
            var bc = normalizeProductBarcode(barcode);
            if (bc) {
                var byBc = findProductWithBarcode(bc, null);
                if (byBc) return byBc;
            }
        }
        var n = String(name || '').trim().toLowerCase();
        if (!n) return null;
        var exact = list.find(function (p) { return String(p.name || '').trim().toLowerCase() === n; });
        if (exact) return exact;
        return list.find(function (p) {
            var pn = String(p.name || '').trim().toLowerCase();
            return pn && (pn.indexOf(n) >= 0 || n.indexOf(pn) >= 0);
        }) || null;
    }

    function suggestSupplierMatch(name) {
        var n = String(name || '').trim().toLowerCase();
        if (!n) return null;
        return getSuppliers().find(function (s) {
            return String(s.name || '').trim().toLowerCase() === n;
        }) || getSuppliers().find(function (s) {
            var sn = String(s.name || '').trim().toLowerCase();
            return sn && (sn.indexOf(n) >= 0 || n.indexOf(sn) >= 0);
        }) || null;
    }

    function normalizeExtraction(raw) {
        var rate = getExchangeRate();
        var currency = String((raw && raw.currency) || 'USD').toUpperCase();
        var items = Array.isArray(raw && raw.lineItems) ? raw.lineItems : [];
        state.invoiceMeta = {
            invoiceNumber: String((raw && raw.invoiceNumber) || '').trim(),
            invoiceDate: normalizeExpiry((raw && raw.invoiceDate) || ''),
            supplierName: String((raw && raw.supplierName) || '').trim(),
            currency: currency,
            notes: String((raw && raw.notes) || '').trim()
        };
        state.rows = items.map(function (item, idx) {
            var qty = Math.max(0, Number(item.quantity) || 0);
            var unit = Number(item.unitCost);
            if (!(unit > 0) && Number(item.totalCost) > 0 && qty > 0) unit = Number(item.totalCost) / qty;
            var row = {
                id: 'row-' + idx + '-' + Date.now(),
                productName: String(item.productName || '').trim(),
                quantity: qty || 1,
                rawUnitCost: unit > 0 ? unit : 0,
                invoiceCurrency: currency,
                unitCostUSD: 0,
                unitCostLBP: 0,
                totalUSD: 0,
                totalLBP: 0,
                expiryDate: normalizeExpiry(item.expiryDate || ''),
                category: String(item.category || '').trim(),
                barcode: String(item.barcode || '').trim(),
                notes: String(item.notes || '').trim(),
                matchedProductId: null,
                matchLabel: '',
                status: 'new',
                needsReview: !!(item.needsReview || !String(item.productName || '').trim() || !(unit > 0)),
                editing: false
            };
            applyCurrencyToRow(row, rate);
            var match = suggestProductMatch(row.productName, row.barcode);
            if (match) {
                row.matchedProductId = match.id;
                row.matchLabel = match.name;
                row.status = 'matched';
            } else if (!row.productName) {
                row.status = 'needs_review';
                row.needsReview = true;
            }
            if (Number(item.confidence) > 0 && Number(item.confidence) < 0.65) {
                row.needsReview = true;
                row.status = 'needs_review';
            }
            return row;
        }).filter(function (r) { return r.productName || r.barcode || r.rawUnitCost > 0; });
        return state.rows.length > 0;
    }

    async function extractViaCloud(imageBase64, mimeType) {
        if (!window.firebaseDb || typeof window.firebaseDb.extractInvoiceFromImageSecure !== 'function') {
            return { ok: false, error: 'cloud_unavailable' };
        }
        try {
            var res = await window.firebaseDb.extractInvoiceFromImageSecure({
                imageBase64: imageBase64,
                mimeType: mimeType || 'image/jpeg'
            });
            if (!res || res.disabled || res.useClientFallback) {
                return { ok: false, error: res && res.message ? res.message : 'extraction_unavailable' };
            }
            if (!res.lineItems || !res.lineItems.length) {
                return { ok: false, error: 'no_items' };
            }
            return { ok: true, data: res };
        } catch (err) {
            console.warn('extractInvoiceFromImageSecure failed:', err);
            return { ok: false, error: String(err && err.message ? err.message : err) };
        }
    }

    function showStep(step) {
        var capture = $('aiInvoiceImportCapture');
        var processing = $('aiInvoiceImportProcessing');
        var review = $('aiInvoiceImportReview');
        var payment = $('aiInvoiceImportPayment');
        var errorBox = $('aiInvoiceImportError');
        var importBtn = $('aiInvoiceImportProductsBtn');
        if (capture) capture.style.display = step === 'capture' ? '' : 'none';
        if (processing) processing.style.display = step === 'processing' ? '' : 'none';
        if (review) review.style.display = step === 'review' ? '' : 'none';
        if (payment) payment.style.display = step === 'payment' ? '' : 'none';
        if (errorBox) errorBox.style.display = step === 'error' ? '' : 'none';
        if (importBtn) importBtn.style.display = step === 'review' ? '' : 'none';
    }

    function resetSession() {
        state.imageFile = null;
        state.imageBase64 = '';
        state.rows = [];
        state.invoiceMeta = { invoiceNumber: '', invoiceDate: '', supplierName: '', currency: 'USD', notes: '' };
        var preview = $('aiInvoiceImagePreviewWrap');
        var img = $('aiInvoiceImagePreview');
        var analyzeBtn = $('aiInvoiceAnalyzeBtn');
        if (preview) preview.style.display = 'none';
        if (img) img.src = '';
        if (analyzeBtn) analyzeBtn.disabled = true;
        showStep('capture');
    }

    function populateSupplierSelect() {
        var sel = $('aiInvoiceSupplierSelect');
        if (!sel) return;
        try {
            if (typeof updateSuppliersDropdown === 'function') updateSuppliersDropdown('aiInvoiceSupplierSelect');
        } catch (_) {}
        var detected = state.invoiceMeta.supplierName;
        var detEl = $('aiInvoiceDetectedSupplier');
        if (detEl) detEl.textContent = detected || '—';
        var match = suggestSupplierMatch(detected);
        if (match) sel.value = String(match.id);
    }

    function updateRateDisplay() {
        var rate = getExchangeRate();
        var el = $('aiInvoiceRateUsed');
        if (el) el.textContent = formatRate(rate);
        var lbl = $('aiInvoiceRateLabel');
        if (lbl) lbl.textContent = txt('Rate used:', 'سعر الصرف المستخدم:');
    }

    function statusBadge(row) {
        if (row.status === 'matched') {
            return '<span class="ai-invoice-status ai-invoice-status--matched">' + txt('Matched', 'مطابق') + '</span>';
        }
        if (row.status === 'new') {
            return '<span class="ai-invoice-status ai-invoice-status--new">' + txt('New Product', 'منتج جديد') + '</span>';
        }
        return '<span class="ai-invoice-status ai-invoice-status--review">' + txt('Needs review', 'يحتاج مراجعة') + '</span>';
    }

    function escHtml(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function escAttr(s) {
        return escHtml(s).replace(/'/g, '&#39;');
    }

    function findRow(id) {
        return state.rows.find(function (r) { return r.id === id; });
    }

    function renderReviewTable() {
        var tbody = $('aiInvoiceReviewTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';
        var rate = getExchangeRate();
        state.rows.forEach(function (row) {
            applyCurrencyToRow(row, rate);
            var tr = document.createElement('tr');
            if (row.needsReview) tr.className = 'ai-invoice-row--uncertain';
            if (row.editing) {
                tr.innerHTML =
                    '<td><input type="text" class="ai-invoice-cell-input" data-field="productName" data-id="' + row.id + '" value="' + escAttr(row.productName) + '" /></td>' +
                    '<td><input type="number" min="0" step="1" class="ai-invoice-cell-input ai-invoice-cell-input--sm" data-field="quantity" data-id="' + row.id + '" value="' + row.quantity + '" /></td>' +
                    '<td><input type="number" min="0" step="0.01" class="ai-invoice-cell-input ai-invoice-cell-input--sm" data-field="unitCostUSD" data-id="' + row.id + '" value="' + row.unitCostUSD + '" /></td>' +
                    '<td><input type="number" min="0" step="1" class="ai-invoice-cell-input ai-invoice-cell-input--sm" data-field="unitCostLBP" data-id="' + row.id + '" value="' + row.unitCostLBP + '" /></td>' +
                    '<td>$' + row.totalUSD.toFixed(2) + '</td>' +
                    '<td><input type="date" class="ai-invoice-cell-input" data-field="expiryDate" data-id="' + row.id + '" value="' + escAttr(row.expiryDate) + '" /></td>' +
                    '<td><input type="text" class="ai-invoice-cell-input" data-field="category" data-id="' + row.id + '" value="' + escAttr(row.category) + '" /></td>' +
                    '<td>' + statusBadge(row) + '</td>' +
                    '<td class="ai-invoice-row-actions">' +
                    '<button type="button" class="ai-invoice-row-btn" data-action="save-edit" data-id="' + row.id + '">' + txt('Save', 'حفظ') + '</button>' +
                    '<button type="button" class="ai-invoice-row-btn" data-action="match" data-id="' + row.id + '">' + txt('Match', 'مطابقة') + '</button>' +
                    '<button type="button" class="ai-invoice-row-btn ai-invoice-row-btn--danger" data-action="remove" data-id="' + row.id + '">' + txt('Remove', 'حذف') + '</button>' +
                    '</td>';
            } else {
                tr.innerHTML =
                    '<td>' + escHtml(row.productName || '—') + (row.matchLabel ? '<br><small>' + escHtml(row.matchLabel) + '</small>' : '') + '</td>' +
                    '<td>' + row.quantity + '</td>' +
                    '<td>$' + (row.unitCostUSD || 0).toFixed(2) + '</td>' +
                    '<td>' + (row.unitCostLBP || 0).toLocaleString() + '</td>' +
                    '<td>$' + row.totalUSD.toFixed(2) + '</td>' +
                    '<td>' + escHtml(row.expiryDate || '—') + '</td>' +
                    '<td>' + escHtml(row.category || '—') + '</td>' +
                    '<td>' + statusBadge(row) + '</td>' +
                    '<td class="ai-invoice-row-actions">' +
                    '<button type="button" class="ai-invoice-row-btn" data-action="edit" data-id="' + row.id + '">' + txt('Edit', 'تعديل') + '</button>' +
                    '<button type="button" class="ai-invoice-row-btn" data-action="match" data-id="' + row.id + '">' + txt('Match', 'مطابقة') + '</button>' +
                    '<button type="button" class="ai-invoice-row-btn" data-action="new" data-id="' + row.id + '">' + txt('New', 'جديد') + '</button>' +
                    '<button type="button" class="ai-invoice-row-btn ai-invoice-row-btn--danger" data-action="remove" data-id="' + row.id + '">' + txt('Remove', 'حذف') + '</button>' +
                    '</td>';
            }
            tbody.appendChild(tr);
        });
        tbody.querySelectorAll('.ai-invoice-cell-input').forEach(function (inp) {
            inp.addEventListener('change', onCellInputChange);
            inp.addEventListener('input', onCellInputChange);
        });
        tbody.querySelectorAll('[data-action]').forEach(function (btn) {
            btn.addEventListener('click', onRowAction);
        });
    }

    function onCellInputChange(e) {
        var inp = e.target;
        var id = inp.getAttribute('data-id');
        var field = inp.getAttribute('data-field');
        var row = findRow(id);
        if (!row || !field) return;
        if (field === 'quantity') row.quantity = Math.max(0, parseInt(inp.value, 10) || 0);
        else if (field === 'unitCostUSD') {
            row.unitCostUSD = round2(parseFloat(inp.value) || 0);
            row.unitCostLBP = roundLbp(row.unitCostUSD * getExchangeRate());
        } else if (field === 'unitCostLBP') {
            row.unitCostLBP = roundLbp(parseFloat(inp.value) || 0);
            row.unitCostUSD = round2(row.unitCostLBP / getExchangeRate());
        } else row[field] = inp.value;
        applyCurrencyToRow(row, getExchangeRate());
        renderReviewTable();
    }

    function onRowAction(e) {
        var btn = e.currentTarget;
        var action = btn.getAttribute('data-action');
        var id = btn.getAttribute('data-id');
        var row = findRow(id);
        if (!row) return;
        if (action === 'edit') { row.editing = true; renderReviewTable(); return; }
        if (action === 'save-edit') {
            row.editing = false;
            row.needsReview = !row.productName || !(row.unitCostUSD > 0);
            row.status = row.matchedProductId ? 'matched' : (row.needsReview ? 'needs_review' : 'new');
            renderReviewTable();
            return;
        }
        if (action === 'remove') {
            state.rows = state.rows.filter(function (r) { return r.id !== id; });
            renderReviewTable();
            return;
        }
        if (action === 'new') {
            row.matchedProductId = null;
            row.matchLabel = '';
            row.status = 'new';
            row.needsReview = false;
            renderReviewTable();
            return;
        }
        if (action === 'match') openMatchPicker(row);
    }

    function openMatchPicker(row) {
        var list = getProducts();
        if (!list.length) {
            if (typeof showMessage === 'function') showMessage(txt('No products to match.', 'لا توجد منتجات للمطابقة.'), 'error');
            return;
        }
        var options = list.slice(0, 200).map(function (p, i) {
            return (i + 1) + '. ' + (p.name || '') + (p.barcode ? ' [' + p.barcode + ']' : '');
        }).join('\n');
        var input = window.prompt(txt('Enter product number to match:\n', 'أدخل رقم المنتج للمطابقة:\n') + options, '');
        if (input == null) return;
        var idx = parseInt(input, 10) - 1;
        if (!(idx >= 0 && idx < list.length)) return;
        var product = list[idx];
        row.matchedProductId = product.id;
        row.matchLabel = product.name;
        row.status = 'matched';
        row.needsReview = false;
        row.editing = false;
        renderReviewTable();
    }

    function fillReviewMeta() {
        var num = $('aiInvoiceNumber');
        var date = $('aiInvoiceDate');
        if (num) num.value = state.invoiceMeta.invoiceNumber || '';
        if (date) date.value = state.invoiceMeta.invoiceDate || '';
        populateSupplierSelect();
        updateRateDisplay();
        var msg = $('aiInvoiceSuccessMsg');
        if (msg) msg.textContent = txt('Invoice analyzed. Please review extracted products.', 'تم تحليل الفاتورة. يرجى مراجعة المنتجات المستخرجة.');
    }

    function mapExtractionError(errCode, errMsg) {
        var code = String(errCode || errMsg || '').toLowerCase();
        if (code.indexOf('not-found') >= 0 || code.indexOf('unavailable') >= 0 || code === 'cloud_unavailable') {
            return txt('AI service is not available yet. Please try again in a moment.', 'خدمة الذكاء الاصطناعي غير متاحة حالياً. حاول مرة أخرى بعد قليل.');
        }
        if (code.indexOf('not configured') >= 0 || code.indexOf('extraction_unavailable') >= 0 || code.indexOf('ai extraction not configured') >= 0) {
            return txt('AI invoice reading is not configured on the server (missing API key).', 'قراءة الفاتورة بالذكاء الاصطناعي غير مفعّلة على السيرفر (مفتاح API مفقود).');
        }
        if (code === 'no_items') {
            return txt('No product lines were found on this invoice. Try a clearer photo.', 'لم يُعثر على منتجات في الفاتورة. جرّب صورة أوضح.');
        }
        return txt('Could not read invoice clearly. Please upload a clearer image.', 'تعذّر قراءة الفاتورة بوضوح. يرجى رفع صورة أوضح.');
    }

    async function handleAnalyze() {
        if (!state.imageBase64) return;
        showStep('processing');
        var proc = $('aiInvoiceProcessingText');
        if (proc) proc.textContent = txt('Analyzing invoice...', 'جاري تحليل الفاتورة...');
        var result = await extractViaCloud(state.imageBase64, state.mimeType);
        if (!result.ok) {
            showStep('error');
            var err = $('aiInvoiceErrorText');
            if (err) err.textContent = mapExtractionError(result.error, result.error);
            return;
        }
        if (!normalizeExtraction(result.data)) {
            showStep('error');
            return;
        }
        fillReviewMeta();
        renderReviewTable();
        showStep('review');
    }

    async function handleImageSelected(file) {
        if (!file || !file.type || file.type.indexOf('image/') !== 0) {
            if (typeof showMessage === 'function') showMessage(txt('Please choose an image file.', 'يرجى اختيار ملف صورة.'), 'error');
            return;
        }
        state.imageFile = file;
        state.mimeType = file.type || 'image/jpeg';
        var dataUrl = await readFileAsDataUrl(file);
        state.imageBase64 = dataUrlToBase64(dataUrl);
        var wrap = $('aiInvoiceImagePreviewWrap');
        var img = $('aiInvoiceImagePreview');
        var analyzeBtn = $('aiInvoiceAnalyzeBtn');
        if (img) img.src = dataUrl;
        if (wrap) wrap.style.display = '';
        if (analyzeBtn) analyzeBtn.disabled = false;
    }

    function openModal() {
        if (!isTestEnv()) return;
        try {
            if (typeof hasProductPermission === 'function' &&
                !hasProductPermission('canAddProducts') && !hasProductPermission('canImportProducts')) {
                if (typeof showPermissionDeniedMessage === 'function') showPermissionDeniedMessage('استيراد الفاتورة', 'import invoices');
                return;
            }
        } catch (_) {}
        resetSession();
        updateLabels();
        if (typeof showModal === 'function') showModal('aiInvoiceImportModal');
    }

    function closeModal() {
        if (typeof hideModal === 'function') hideModal('aiInvoiceImportModal');
        resetSession();
    }

    function updateLabels() {
        var title = $('aiInvoiceImportTitle');
        var sub = $('aiInvoiceImportSubtitle');
        if (title) title.textContent = txt('AI Invoice Import', 'استيراد فاتورة بالذكاء الاصطناعي');
        if (sub) sub.textContent = txt('Upload or capture a supplier invoice and let AI extract products for review.', 'ارفع أو صوّر فاتورة مورد ودع الذكاء الاصطناعي يستخرج المنتجات للمراجعة.');
    }

    function validateBeforeImport() {
        if (!state.rows.length) {
            if (typeof showMessage === 'function') showMessage(txt('No products to import.', 'لا توجد منتجات للاستيراد.'), 'error');
            return false;
        }
        for (var i = 0; i < state.rows.length; i++) {
            var r = state.rows[i];
            if (!String(r.productName || '').trim()) {
                if (typeof showMessage === 'function') showMessage(txt('Each row needs a product name.', 'كل صف يحتاج اسم منتج.'), 'error');
                return false;
            }
            if (!(Number(r.quantity) > 0)) {
                if (typeof showMessage === 'function') showMessage(txt('Quantity must be greater than zero.', 'الكمية يجب أن تكون أكبر من صفر.'), 'error');
                return false;
            }
        }
        return true;
    }

    function allocNextProductId() {
        var list = getProducts();
        var deletedSet = (window.__deletedProductIds instanceof Set) ? window.__deletedProductIds : new Set();
        var used = new Set();
        list.forEach(function (p) {
            var n = Number(p && p.id);
            if (Number.isFinite(n) && n > 0) used.add(Math.floor(n));
        });
        deletedSet.forEach(function (id) {
            var n = Number(id);
            if (Number.isFinite(n) && n > 0) used.add(Math.floor(n));
        });
        var next = used.size ? (Math.max.apply(null, Array.from(used)) + 1) : 1;
        while (deletedSet.has(String(next)) || list.some(function (p) { return String(p && p.id) === String(next); })) next += 1;
        return next;
    }

    async function executeImport(paymentMode) {
        var rate = getExchangeRate();
        var supplierId = $('aiInvoiceSupplierSelect') && $('aiInvoiceSupplierSelect').value;
        var invoiceNumber = ($('aiInvoiceNumber') && $('aiInvoiceNumber').value) || state.invoiceMeta.invoiceNumber || '';
        var invoiceDate = ($('aiInvoiceDate') && $('aiInvoiceDate').value) || state.invoiceMeta.invoiceDate || new Date().toISOString().split('T')[0];
        var billItems = [];
        var totalUSD = 0;
        var reservedIds = new Set();

        for (var i = 0; i < state.rows.length; i++) {
            var row = state.rows[i];
            applyCurrencyToRow(row, rate);
            var qty = Math.max(0, Number(row.quantity) || 0);
            var unitCost = Number(row.unitCostUSD) || 0;
            totalUSD += unitCost * qty;

            if (row.matchedProductId) {
                var existing = getProducts().find(function (p) { return String(p.id) === String(row.matchedProductId); });
                if (existing) {
                    if (typeof addPackStockToProduct === 'function') addPackStockToProduct(existing, qty);
                    existing.costUSD = unitCost;
                    if (row.expiryDate) existing.expiryDate = row.expiryDate;
                    if (typeof touchProductClientTimestamp === 'function') touchProductClientTimestamp(existing);
                    try { enqueueSyncOp('products', 'upsert', existing.id, existing); } catch (_) {}
                    if (typeof recordStockMovement === 'function') {
                        recordStockMovement('adjustment', existing.id, qty, invoiceNumber, 'AI Invoice Import', { source: 'invoice_import', unitCostUSD: unitCost });
                    }
                    if (typeof appendProductLog === 'function') appendProductLog(existing.id, 'invoice_import', '+' + qty + ' @ $' + unitCost.toFixed(2));
                    billItems.push({ productId: existing.id, quantity: qty, price: unitCost, name: existing.name });
                    continue;
                }
            }

            var category = String(row.category || '').trim();
            if (!category) category = isEn() ? 'General' : 'عام';
            if (typeof normalizeCategoryName === 'function') category = normalizeCategoryName(category);
            if (typeof upsertProductCategory === 'function') category = upsertProductCategory(category);

            var retailUSD = round2(Math.max(unitCost * 1.25, unitCost + 0.01));
            var newId = allocNextProductId();
            while (reservedIds.has(newId)) { newId += 1; }
            reservedIds.add(newId);

            var newProduct = {
                id: newId,
                name: String(row.productName).trim(),
                category: category,
                prices: {
                    retail: { USD: retailUSD, LBP: roundLbp(retailUSD * rate) },
                    wholesale: { USD: retailUSD, LBP: roundLbp(retailUSD * rate) },
                    vip: { USD: retailUSD, LBP: roundLbp(retailUSD * rate) }
                },
                priceUSD: retailUSD,
                priceLBP: roundLbp(retailUSD * rate),
                costUSD: unitCost,
                stock: qty,
                barcode: row.barcode || '',
                supplier: supplierId || '',
                supplierName: supplierId ? ((getSuppliers().find(function (s) { return String(s.id) === String(supplierId); }) || {}).name || '') : '',
                expiryDate: row.expiryDate || '',
                minStock: 5,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            if (typeof products !== 'undefined' && Array.isArray(products)) products.push(newProduct);
            try { enqueueSyncOp('products', 'upsert', newProduct.id, newProduct); } catch (_) {}
            if (typeof recordStockMovement === 'function') {
                recordStockMovement('adjustment', newProduct.id, qty, invoiceNumber, 'AI Invoice Import (new)', { source: 'invoice_import', unitCostUSD: unitCost });
            }
            if (typeof appendProductLog === 'function') appendProductLog(newProduct.id, 'create', 'AI Invoice Import');
            if (qty > 0 && unitCost > 0 && typeof recordProductSupplyExpense === 'function') {
                recordProductSupplyExpense(newProduct.name, qty, unitCost, 'USD');
            }
            billItems.push({ productId: newId, quantity: qty, price: unitCost, name: newProduct.name });
        }

        if (supplierId && billItems.length && typeof createRecordId === 'function') {
            try {
                var paidNow = paymentMode === 'paid' ? totalUSD : 0;
                var rem = Math.max(0, totalUSD - paidNow);
                var bill = {
                    id: createRecordId('pu'),
                    supplierId: Number(supplierId) || supplierId,
                    date: invoiceDate,
                    dueDate: '',
                    currency: 'USD',
                    rate: rate,
                    items: billItems,
                    total: totalUSD,
                    totalUSD: totalUSD,
                    paidUSD: paidNow,
                    status: 'unpaid',
                    invoiceNumber: invoiceNumber,
                    source: 'ai_invoice_import'
                };
                if (typeof recalcPurchaseStatus === 'function') recalcPurchaseStatus(bill);
                if (typeof purchases !== 'undefined' && Array.isArray(purchases)) purchases.push(bill);
                if (typeof addSupplierLedgerEntry === 'function') {
                    addSupplierLedgerEntry({
                        supplier_id: bill.supplierId,
                        type: 'PURCHASE',
                        ref_no: String(bill.id),
                        product_name: billItems.map(function (it) { return it.name; }).join(', ').slice(0, 120),
                        total_cost: totalUSD,
                        paid_now: paidNow,
                        remaining: rem,
                        note: 'AI Invoice Import' + (invoiceNumber ? ' #' + invoiceNumber : ''),
                        currency: 'USD',
                        rate: rate
                    });
                }
                if (paidNow > 0 && typeof recordSupplierPaymentCash === 'function') {
                    if (typeof supplierPayments !== 'undefined' && Array.isArray(supplierPayments)) {
                        supplierPayments.push({
                            id: createRecordId('sp'),
                            supplierId: bill.supplierId,
                            date: new Date().toISOString(),
                            currency: 'USD',
                            amount: paidNow,
                            rate: rate,
                            method: 'cash',
                            note: 'AI Invoice Import',
                            appliedTo: [{ billId: bill.id, amountUSD: paidNow }]
                        });
                    }
                    recordSupplierPaymentCash(paidNow, 'USD', 'cash', 'AI Invoice Import');
                }
                try { enqueueSyncOp('purchases', 'upsert', bill.id, bill); } catch (_) {}
            } catch (e) {
                console.warn('supplier bill for invoice import', e);
            }
        }

        try {
            if (typeof saveToStorage === 'function') saveToStorage('products', window.products);
            if (typeof saveAllData === 'function') saveAllData();
            if (typeof flushSyncQueue === 'function') await flushSyncQueue();
        } catch (_) {}

        if (typeof loadProducts === 'function') loadProducts();
        if (typeof notifyProductsUpdated === 'function') notifyProductsUpdated();
        if (typeof showMessage === 'function') showMessage(txt('Products imported successfully.', 'تم استيراد المنتجات بنجاح.'), 'success');
        closeModal();
    }

    function bindEvents() {
        if (state.bound) return;
        state.bound = true;

        var openBtn = $('aiInvoiceImportBtn');
        if (openBtn) openBtn.addEventListener('click', openModal);

        var closeBtn = $('aiInvoiceImportCloseBtn');
        var cancelBtn = $('aiInvoiceCancelBtn');
        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

        var uploadBtn = $('aiInvoiceUploadBtn');
        var cameraBtn = $('aiInvoiceCameraBtn');
        var fileInput = $('aiInvoiceFileInput');
        var cameraInput = $('aiInvoiceCameraInput');
        var analyzeBtn = $('aiInvoiceAnalyzeBtn');
        var importBtn = $('aiInvoiceImportProductsBtn');
        var paidBtn = $('aiInvoicePaidNowBtn');
        var creditBtn = $('aiInvoiceCreditBtn');
        var addSupBtn = $('aiInvoiceAddSupplierBtn');

        if (uploadBtn && fileInput) {
            uploadBtn.addEventListener('click', function () { fileInput.click(); });
            fileInput.addEventListener('change', function () {
                if (fileInput.files && fileInput.files[0]) handleImageSelected(fileInput.files[0]);
                fileInput.value = '';
            });
        }
        if (cameraBtn && cameraInput) {
            cameraBtn.addEventListener('click', function () { cameraInput.click(); });
            cameraInput.addEventListener('change', function () {
                if (cameraInput.files && cameraInput.files[0]) handleImageSelected(cameraInput.files[0]);
                cameraInput.value = '';
            });
        }
        if (analyzeBtn) analyzeBtn.addEventListener('click', handleAnalyze);
        if (importBtn) {
            importBtn.addEventListener('click', function () {
                if (!validateBeforeImport()) return;
                showStep('payment');
            });
        }
        if (paidBtn) paidBtn.addEventListener('click', function () { executeImport('paid'); });
        if (creditBtn) creditBtn.addEventListener('click', function () { executeImport('credit'); });
        if (addSupBtn) {
            addSupBtn.addEventListener('click', function () {
                window.__supplierInlineTargetSelectId = 'aiInvoiceSupplierSelect';
                if (typeof showModal === 'function') showModal('addSupplierModal');
            });
        }
    }

    window.initAiInvoiceImport = function () {
        showImportButtonIfTest();
        updateLabels();
        bindEvents();
        try {
            if (typeof updateSuppliersDropdown === 'function') updateSuppliersDropdown('aiInvoiceSupplierSelect');
        } catch (_) {}
    };

    document.addEventListener('DOMContentLoaded', function () {
        setTimeout(function () {
            try { window.initAiInvoiceImport(); } catch (_) {}
        }, 300);
    });
})();
