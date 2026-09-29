// Super Admin Panel — minimal UI (cards + Add days modal only)
// Access is driven by server-issued super_admin claims.

const SA_PROMOTE_BTN_HTML = '<i class="fas fa-upload" aria-hidden="true"></i> Promote TEST Build to Production';

class SuperAdminDashboard {
    constructor() {
        this.db = window.firebaseDbInstance;
        this.auth = window.firebaseAuthInstance;
        this.allUsers = [];
        this.filteredUsers = [];
        this.usageStatsByUid = {};
        this.currentPage = 1;
        this.pageSize = 20;
        this.statusFilter = 'all';
        this.sortKey = 'name';
        this.sortDirection = 'asc';
        this._usageStatsUnsub = null;
        this._appUpdateUnsub = null;
        this.pendingAddDaysUid = null;
        this.isLoading = false;
        this._dayRemainTicker = null;
        this._lastUsageRecalcAt = 0;
        this.featureFlagsCache = {};
        this._obsRefreshTimer = null;
        this._obsCharts = {};
        this._lastAlertSignature = '';
        this._featureTargetsDraft = new Set();
        this._updateTargetUserIds = new Set();
        this._lastUpdateControlState = {};
        this._deploymentStatus = {};
        this._deploymentStatusLoaded = false;
        this._deploymentStatusLoading = false;
        this._deploymentStatusLoadPromise = null;
        this._deploymentStatusLoadSeq = 0;
        this._releaseInFlight = false;
        this._promoteInFlight = false;
        this._obsHours = 1;
        this.init();
    }

    init() {
        this.hideSuperAdminLink();
        this._ensureTargetPickerModals();
        this.setupEventListeners();
        this._startDaysRemainTicker();
        this._renderDeploymentPanel({});
        this._refreshReleaseFormValidation();
        this.refreshAccess();
    }

    _setupLiveSubscriptions() {
        if (this.db && typeof this.db.subscribeUsageStats === 'function' && !this._usageStatsUnsub) {
            this._usageStatsUnsub = this.db.subscribeUsageStats((statsMap) => {
                this.usageStatsByUid = statsMap || {};
                if (this.filteredUsers && this.filteredUsers.length) this.renderUsers();
            }, { all: true });
        }
        if (this.db && typeof this.db.subscribeAppUpdateControl === 'function' && !this._appUpdateUnsub) {
            this._appUpdateUnsub = this.db.subscribeAppUpdateControl((state) => {
                this._renderUpdateControl(state || {});
            });
        }
    }

    _teardownLiveSubscriptions() {
        try {
            if (typeof this._usageStatsUnsub === 'function') this._usageStatsUnsub();
        } catch (_) {}
        try {
            if (typeof this._appUpdateUnsub === 'function') this._appUpdateUnsub();
        } catch (_) {}
        this._usageStatsUnsub = null;
        this._appUpdateUnsub = null;
        if (this._obsRefreshTimer) {
            clearInterval(this._obsRefreshTimer);
            this._obsRefreshTimer = null;
        }
    }

    /** Re-render user cards periodically so "days left" stays accurate on an open page. */
    _startDaysRemainTicker() {
        if (this._dayRemainTicker) clearInterval(this._dayRemainTicker);
        this._dayRemainTicker = setInterval(() => {
            const page = document.getElementById('superAdmin');
            if (!page || !page.classList.contains('active')) return;
            if (this.isLoading || !this.filteredUsers.length) return;
            this.renderUsers();
        }, 60000);
    }

    _escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _targetInitials(name) {
        const parts = String(name || 'U').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return 'U';
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
    }

    _filterUsersForTargetPicker(searchInputId) {
        const term = String((document.getElementById(searchInputId) || {}).value || '').toLowerCase().trim();
        const rows = Array.isArray(this.allUsers) ? this.allUsers : [];
        return rows.filter((u) => {
            const uid = String(u.id || u.uid || '').toLowerCase();
            const name = String(u.fullName || u.name || '').toLowerCase();
            const email = String(u.email || '').toLowerCase();
            if (!term) return true;
            return uid.includes(term) || name.includes(term) || email.includes(term);
        }).slice(0, 200);
    }

    _buildTargetOptionHtml(u, uid, checked, dataAttr) {
        const name = u.fullName || u.name || 'User';
        const email = u.email || uid;
        const initials = this._targetInitials(name);
        return `
            <label class="sa-target-option" role="option">
                <input type="checkbox" ${dataAttr}="${this._escapeHtml(uid)}" ${checked}>
                <span class="sa-target-option__avatar" aria-hidden="true">${this._escapeHtml(initials)}</span>
                <span class="sa-target-option__info">
                    <span class="sa-target-option__name">${this._escapeHtml(name)}</span>
                    <span class="sa-target-option__email">${this._escapeHtml(email)}</span>
                </span>
            </label>
        `;
    }

    _bindTargetOptionCheckboxes(root, dataAttr, targetSet, onChange) {
        if (!root) return;
        root.querySelectorAll(`input[type="checkbox"][${dataAttr}]`).forEach((el) => {
            el.addEventListener('change', (e) => {
                const uid = String(e.target.getAttribute(dataAttr) || '').trim();
                if (!uid) return;
                if (e.target.checked) targetSet.add(uid);
                else targetSet.delete(uid);
                if (typeof onChange === 'function') onChange();
            });
        });
    }

    _updateTargetModalCount(countElId, targetSet) {
        const countEl = document.getElementById(countElId);
        if (!countEl) return;
        const n = targetSet ? targetSet.size : 0;
        countEl.textContent = `${n} selected`;
    }

    _targetPickerModalBodyHtml(config) {
        const {
            searchId,
            countId,
            optionsId,
            selectAllId,
            clearAllId
        } = config;
        return `
            <div class="sa-targets-search-wrap">
                <i class="fas fa-search" aria-hidden="true"></i>
                <input type="search" id="${searchId}" class="sa-targets-search" placeholder="Search by name, email, or UID" autocomplete="off">
            </div>
            <div class="sa-targets-toolbar">
                <span class="sa-targets-count" id="${countId}">0 selected</span>
                <div class="sa-targets-actions">
                    <button type="button" class="sa-targets-link-btn" id="${selectAllId}">Select visible</button>
                    <button type="button" class="sa-targets-link-btn" id="${clearAllId}">Clear all</button>
                </div>
            </div>
            <div id="${optionsId}" class="sa-feature-targets-options" role="listbox" aria-multiselectable="true"></div>
        `;
    }

    _ensureTargetPickerModals() {
        const specs = [
            {
                modalId: 'saUpdateTargetsModal',
                titleHtml: '<i class="fas fa-rocket" aria-hidden="true"></i> App update target users',
                searchId: 'saUpdateTargetsSearch',
                countId: 'saUpdateTargetsModalCount',
                optionsId: 'saUpdateTargetsOptions',
                selectAllId: 'saUpdateTargetsSelectAll',
                clearAllId: 'saUpdateTargetsClearAll'
            },
            {
                modalId: 'saFeatureTargetsModal',
                titleHtml: '<i class="fas fa-users" aria-hidden="true"></i> Targeted users rollout',
                searchId: 'saFeatureTargetsSearch',
                countId: 'saFeatureTargetsModalCount',
                optionsId: 'saFeatureTargetsOptions',
                selectAllId: 'saFeatureTargetsSelectAll',
                clearAllId: 'saFeatureTargetsClearAll'
            }
        ];
        specs.forEach((spec) => {
            const modal = document.getElementById(spec.modalId);
            if (!modal) return;
            modal.classList.add('sa-add-days-modal', 'sa-targets-picker-modal');
            const titleEl = modal.querySelector('.modal-header h3');
            if (titleEl && !titleEl.querySelector('i')) titleEl.innerHTML = spec.titleHtml;
            const body = modal.querySelector('.modal-body');
            if (!body) return;
            const needsUpgrade = !body.querySelector('.sa-targets-search-wrap');
            if (!needsUpgrade) return;
            body.classList.add('sa-targets-modal-body');
            body.innerHTML = this._targetPickerModalBodyHtml(spec);
            this._wireTargetPickerModalControls(true);
        });
    }

    _wireTargetPickerModalControls(onlyNew = false) {
        const searchPairs = [
            ['saUpdateTargetsSearch', () => this.renderUpdateTargetsOptions()],
            ['saFeatureTargetsSearch', () => this.renderFeatureTargetsOptions()]
        ];
        const buttonPairs = [
            ['saUpdateTargetsSelectAll', () => this._selectVisibleUpdateTargets()],
            ['saUpdateTargetsClearAll', () => this._clearAllUpdateTargets()],
            ['saFeatureTargetsSelectAll', () => this._selectVisibleFeatureTargets()],
            ['saFeatureTargetsClearAll', () => this._clearAllFeatureTargets()]
        ];
        searchPairs.forEach(([id, handler]) => {
            const el = document.getElementById(id);
            if (!el || (onlyNew && el.dataset.saTargetPickerBound === '1')) return;
            el.dataset.saTargetPickerBound = '1';
            el.addEventListener('input', handler);
        });
        buttonPairs.forEach(([id, handler]) => {
            const el = document.getElementById(id);
            if (!el || (onlyNew && el.dataset.saTargetPickerBound === '1')) return;
            el.dataset.saTargetPickerBound = '1';
            el.addEventListener('click', handler);
        });
    }

    _normalizeEmail(email) {
        return String(email || '').trim().toLowerCase();
    }

    async _getAccessState() {
        const fbAuth = this.auth && this.auth.auth;
        const authUser = fbAuth && fbAuth.currentUser ? fbAuth.currentUser : null;
        if (!authUser) return { allowed: false, email: '', hasClaim: false, roleSuper: false, needsBootstrap: false };

        const userRole = String((this.auth.currentUser && this.auth.currentUser.role) || '').toLowerCase();
        const roleSuper = userRole === 'superadmin';
        let claims = (this.auth.currentUser && this.auth.currentUser.claims) || {};
        try {
            const tokenResult = await authUser.getIdTokenResult(true);
            claims = (tokenResult && tokenResult.claims) ? tokenResult.claims : claims;
        } catch (_) {}

        const hasClaim = !!(claims.super_admin === true || claims.superAdmin === true);
        const allowed = hasClaim;
        const needsBootstrap = roleSuper && !hasClaim;
        return { allowed, hasClaim, roleSuper, needsBootstrap };
    }

    async refreshAccess() {
        const access = await this._getAccessState();
        if (access.allowed) {
            this.showSuperAdminLink();
            this._setupLiveSubscriptions();
            if (this._isTestEnvironment()) {
                this.ensureAppVersionBaseline().finally(() => {
                    this.loadDeploymentStatus();
                });
            } else {
                this._renderDeploymentPanel(this._deploymentStatus);
                this._refreshReleaseFormValidation();
            }
            return true;
        }
        this._teardownLiveSubscriptions();
        this.hideSuperAdminLink();
        this._renderBlockedState();
        return false;
    }

    showSuperAdminLink() {
        const authUser = this.auth && this.auth.currentUser ? this.auth.currentUser : null;
        const claims = (authUser && authUser.claims) || {};
        const hasClaim = !!(claims.super_admin === true || claims.superAdmin === true);
        if (!hasClaim) {
            this.hideSuperAdminLink();
            return;
        }
        const superAdminNav = document.querySelector('.nav-item.super-admin-only');
        if (superAdminNav) superAdminNav.style.display = 'flex';
    }

    hideSuperAdminLink() {
        const superAdminNav = document.querySelector('.nav-item.super-admin-only');
        if (superAdminNav) superAdminNav.style.display = 'none';
    }

    _hasSuperAdminAccess() {
        if (typeof isCurrentSessionSuperAdmin === 'function' && isCurrentSessionSuperAdmin()) return true;
        const authUser = this.auth && this.auth.currentUser ? this.auth.currentUser : null;
        const claims = (authUser && authUser.claims) || {};
        return !!(claims.super_admin === true || claims.superAdmin === true);
    }

    _tableBodyRoot() {
        return document.getElementById('superAdminUsersTbody');
    }

    _setStatusLine(message, tone = 'neutral') {
        const el = document.getElementById('superAdminShowingCount');
        if (!el) return;
        const text = String(message || '').trim();
        el.textContent = text;
        el.style.color = tone === 'error'
            ? '#b42318'
            : (tone === 'success' ? '#166534' : '');
    }

    _renderTableMessage(type, text) {
        const root = this._tableBodyRoot();
        if (!root) return;
        const safeText = this._escapeHtml(String(text || ''));
        const icon = type === 'loading'
            ? '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i>'
            : (type === 'error'
                ? '<i class="fas fa-exclamation-triangle" aria-hidden="true"></i>'
                : '<i class="fas fa-info-circle" aria-hidden="true"></i>');
        const klass = type === 'error'
            ? 'sa-user-card--error'
            : (type === 'loading' ? 'sa-user-card--loading' : 'sa-user-card--empty');
        const role = type === 'error' ? 'alert' : 'status';
        root.innerHTML = `
            <tr><td colspan="6">
                <div class="sa-user-card sa-user-card--message ${klass}" role="${role}">
                    ${icon}
                    <p>${safeText}</p>
                </div>
            </td></tr>
        `;
    }

    _authContextSummary() {
        try {
            const authUser = this.auth && this.auth.currentUser ? this.auth.currentUser : {};
            const claims = (authUser && authUser.claims) || {};
            const role = String((authUser && authUser.role) || 'unknown');
            const uid = String((authUser && authUser.uid) || '').trim();
            const ownerId = String(
                (authUser && (
                    authUser.parentAdminId ||
                    authUser.ownerId ||
                    authUser.storeOwnerId ||
                    authUser.createdByUid
                )) || uid || ''
            ).trim();
            const storeId = String((authUser && authUser.storeId) || '').trim();
            const tenantId = String(
                (authUser && (
                    authUser.tenantId ||
                    authUser.tenantID ||
                    authUser.tenant
                )) || ''
            ).trim();
            const hasSuperClaim = !!(claims.super_admin === true || claims.superAdmin === true);
            return { uid, role, ownerId, storeId, tenantId, hasSuperClaim };
        } catch (_) {
            return {
                uid: '',
                role: 'unknown',
                ownerId: '',
                storeId: '',
                tenantId: '',
                hasSuperClaim: false
            };
        }
    }

    _updateAccessDiagnostics() {
        const ctx = this._authContextSummary();
        const parts = [
            `Role: ${ctx.role}`,
            `Super claim: ${ctx.hasSuperClaim ? 'yes' : 'no'}`,
            ctx.ownerId ? `Owner: ${ctx.ownerId}` : '',
            ctx.storeId ? `Store: ${ctx.storeId}` : '',
            ctx.tenantId ? `Tenant: ${ctx.tenantId}` : '',
            ctx.uid ? `UID: ${ctx.uid}` : ''
        ].filter(Boolean);
        if (parts.length) this._setStatusLine(parts.join(' | '), 'neutral');
    }

    _renderBlockedState() {
        this._renderTableMessage('error', 'Access denied. Super admin privileges are required.');
        this._updateAccessDiagnostics();
    }

    setupEventListeners() {
        const refreshBtn = document.getElementById('refreshUsersBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.loadUsers());
        }

        const searchInput = document.getElementById('userSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.filterUsers(e.target.value));
        }

        const superAdminNav = document.querySelector('.nav-item[data-screen="superAdmin"]');
        if (superAdminNav) {
            superAdminNav.addEventListener('click', () => {
                this._setupLiveSubscriptions();
                this._renderCurrentBuild();
                if (this._isTestEnvironment()) {
                    this.ensureAppVersionBaseline().finally(() => this.loadDeploymentStatus());
                } else {
                    this.loadDeploymentStatus();
                }
                this.loadSimpleUpdateStats();
                this.loadUsers();
            });
        }
        const promoteBtn = document.getElementById('saPromoteTestBuildBtn');
        if (promoteBtn) {
            promoteBtn.addEventListener('click', () => this.promoteTestBuildToProduction());
        }
        const releaseBtn = document.getElementById('saReleaseUpdateBtn');
        if (releaseBtn) {
            releaseBtn.addEventListener('click', () => this.releasePendingUpdate());
        }
        const versionLabelInput = document.getElementById('saUpdateVersionLabel');
        if (versionLabelInput) {
            versionLabelInput.addEventListener('input', () => this._refreshReleaseFormValidation());
            versionLabelInput.addEventListener('blur', () => this._refreshReleaseFormValidation());
        }
        const changelogInput = document.getElementById('saUpdateChangelog');
        if (changelogInput) {
            changelogInput.addEventListener('input', () => this._refreshReleaseFormValidation());
        }
        const updateRolloutMode = document.getElementById('saUpdateRolloutMode');
        if (updateRolloutMode) {
            updateRolloutMode.addEventListener('change', () => this._onUpdateRolloutModeChange());
        }
        const updatePickTargetsBtn = document.getElementById('saUpdatePickTargetsBtn');
        if (updatePickTargetsBtn) {
            updatePickTargetsBtn.addEventListener('click', () => this.openUpdateTargetsModal());
        }
        const updateTargetsModalClose = document.getElementById('saUpdateTargetsModalClose');
        if (updateTargetsModalClose) updateTargetsModalClose.addEventListener('click', () => this.closeUpdateTargetsModal());
        const updateTargetsModalCancel = document.getElementById('saUpdateTargetsCancelBtn');
        if (updateTargetsModalCancel) updateTargetsModalCancel.addEventListener('click', () => this.closeUpdateTargetsModal());
        const updateTargetsApplyBtn = document.getElementById('saUpdateTargetsApplyBtn');
        if (updateTargetsApplyBtn) updateTargetsApplyBtn.addEventListener('click', () => this.applyUpdateTargetsFromModal());
        const updateTargetsSearch = document.getElementById('saUpdateTargetsSearch');
        if (updateTargetsSearch) {
            updateTargetsSearch.addEventListener('input', () => this.renderUpdateTargetsOptions());
        }
        const updateTargetsSelectAll = document.getElementById('saUpdateTargetsSelectAll');
        if (updateTargetsSelectAll) {
            updateTargetsSelectAll.addEventListener('click', () => this._selectVisibleUpdateTargets());
        }
        const updateTargetsClearAll = document.getElementById('saUpdateTargetsClearAll');
        if (updateTargetsClearAll) {
            updateTargetsClearAll.addEventListener('click', () => this._clearAllUpdateTargets());
        }
        const updateTargetsModal = document.getElementById('saUpdateTargetsModal');
        if (updateTargetsModal) {
            updateTargetsModal.addEventListener('click', (e) => {
                if (e.target === updateTargetsModal) this.closeUpdateTargetsModal();
            });
        }
        const saveFlagBtn = document.getElementById('saSaveFeatureFlagBtn');
        if (saveFlagBtn) {
            saveFlagBtn.addEventListener('click', () => this.saveFeatureFlagFromUi());
        }
        const refreshFlagsBtn = document.getElementById('saRefreshFeatureFlagsBtn');
        if (refreshFlagsBtn) {
            refreshFlagsBtn.addEventListener('click', () => this.loadFeatureFlagsSummary());
        }
        const pickTargetsBtn = document.getElementById('saPickFeatureTargetsBtn');
        if (pickTargetsBtn) {
            pickTargetsBtn.addEventListener('click', () => this.openFeatureTargetsModal());
        }
        const targetsModalClose = document.getElementById('saFeatureTargetsModalClose');
        if (targetsModalClose) targetsModalClose.addEventListener('click', () => this.closeFeatureTargetsModal());
        const targetsModalCancel = document.getElementById('saFeatureTargetsCancelBtn');
        if (targetsModalCancel) targetsModalCancel.addEventListener('click', () => this.closeFeatureTargetsModal());
        const targetsApplyBtn = document.getElementById('saFeatureTargetsApplyBtn');
        if (targetsApplyBtn) targetsApplyBtn.addEventListener('click', () => this.applyFeatureTargetsFromModal());
        const targetsSearch = document.getElementById('saFeatureTargetsSearch');
        if (targetsSearch) {
            targetsSearch.addEventListener('input', () => this.renderFeatureTargetsOptions());
        }
        const featureTargetsSelectAll = document.getElementById('saFeatureTargetsSelectAll');
        if (featureTargetsSelectAll) {
            featureTargetsSelectAll.addEventListener('click', () => this._selectVisibleFeatureTargets());
        }
        const featureTargetsClearAll = document.getElementById('saFeatureTargetsClearAll');
        if (featureTargetsClearAll) {
            featureTargetsClearAll.addEventListener('click', () => this._clearAllFeatureTargets());
        }
        const flagsList = document.getElementById('saFeatureFlagsList');
        if (flagsList) {
            flagsList.addEventListener('click', (e) => this._handleFeatureFlagsListClick(e));
        }
        const refreshObsBtn = document.getElementById('saRefreshObservabilityBtn');
        if (refreshObsBtn) {
            refreshObsBtn.addEventListener('click', () => this.loadObservabilityDashboard(true));
        }
        const obsHoursEl = document.getElementById('saObservabilityHours');
        if (obsHoursEl) {
            obsHoursEl.addEventListener('change', () => {
                this._obsHours = Math.max(1, Math.min(Number(obsHoursEl.value || 1) || 1, 24));
                this.loadObservabilityDashboard(true);
            });
        }
        const clearObsErrorsBtn = document.getElementById('saClearObservabilityErrorsBtn');
        if (clearObsErrorsBtn) {
            clearObsErrorsBtn.addEventListener('click', () => this.clearOldObservabilityErrors());
        }

        const tableBody = this._tableBodyRoot();
        if (tableBody) {
            tableBody.addEventListener('click', (e) => this._handleUserTableClick(e));
        }
        const statusFilter = document.getElementById('saStatusFilter');
        if (statusFilter) {
            statusFilter.addEventListener('change', (e) => {
                this.statusFilter = String(e.target.value || 'all');
                this.currentPage = 1;
                this.renderUsers();
            });
        }
        const pageSizeEl = document.getElementById('saPageSize');
        if (pageSizeEl) {
            pageSizeEl.addEventListener('change', (e) => {
                this.pageSize = Math.max(1, Number(e.target.value || 20) || 20);
                this.currentPage = 1;
                this.renderUsers();
            });
        }
        const prevBtn = document.getElementById('saPrevPageBtn');
        if (prevBtn) prevBtn.addEventListener('click', () => this._changePage(-1));
        const nextBtn = document.getElementById('saNextPageBtn');
        if (nextBtn) nextBtn.addEventListener('click', () => this._changePage(1));
        const tableHead = document.querySelector('#superAdmin .sa-users-table thead');
        if (tableHead) {
            tableHead.addEventListener('click', (e) => {
                const th = e.target && e.target.closest ? e.target.closest('th.sa-sortable[data-sort]') : null;
                if (!th) return;
                const key = String(th.getAttribute('data-sort') || '').trim();
                if (!key) return;
                if (this.sortKey === key) this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
                else {
                    this.sortKey = key;
                    this.sortDirection = key === 'endDate' ? 'asc' : 'desc';
                }
                this.currentPage = 1;
                this.renderUsers();
            });
        }

        const closeBtn = document.getElementById('superAdminAddDaysModalClose');
        const cancelBtn = document.getElementById('saAddDaysCancelBtn');
        const saveBtn = document.getElementById('saAddDaysSaveBtn');
        const modal = document.getElementById('superAdminAddDaysModal');

        if (closeBtn) closeBtn.addEventListener('click', () => this.closeAddDaysModal());
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeAddDaysModal());
        if (saveBtn) saveBtn.addEventListener('click', () => this.saveAddDays());
        const daysInput = document.getElementById('saAddDaysInput');
        if (daysInput) {
            daysInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.saveAddDays();
                }
            });
        }
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.closeAddDaysModal();
            });
        }
        const targetsModal = document.getElementById('saFeatureTargetsModal');
        if (targetsModal) {
            targetsModal.addEventListener('click', (e) => {
                if (e.target === targetsModal) this.closeFeatureTargetsModal();
            });
        }
    }

    async _guardAccess() {
        const allowed = await this.refreshAccess();
        if (!allowed) {
            if (typeof showMessage === 'function') {
                showMessage('Access denied. Super admin privileges are required.', 'error');
            }
            return false;
        }
        return true;
    }

    _subscriptionStatus(subscription) {
        if (!subscription || !subscription.activated) return 'Expired';
        if (subscription.lifetime) return 'Lifetime';
        if (!subscription.endDate) return 'Expired';
        const end = new Date(subscription.endDate);
        if (isNaN(end.getTime())) return 'Expired';
        return end >= new Date() ? 'Active' : 'Expired';
    }

    _statusBadge(status) {
        if (status === 'Lifetime') return '<span class="status-badge status-sub-lifetime">Lifetime</span>';
        if (status === 'Active') return '<span class="status-badge status-sub-active">Active</span>';
        return '<span class="status-badge status-sub-expired">Expired</span>';
    }

    _formatDate(value) {
        if (!value) return '—';
        const d = new Date(value);
        if (isNaN(d.getTime())) return '—';
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    /** Local calendar midnight for date `d` (subscription end is compared by calendar day). */
    _startOfLocalDay(d) {
        const x = new Date(d);
        if (isNaN(x.getTime())) return null;
        return new Date(x.getFullYear(), x.getMonth(), x.getDate());
    }

    /**
     * Days from today (local) to subscription end date (local calendar day).
     * 0 = ends today, negative = expired that many calendar days ago.
     */
    _calendarDaysToEnd(endValue) {
        const endDay = this._startOfLocalDay(endValue);
        if (!endDay) return null;
        const today = this._startOfLocalDay(new Date());
        return Math.round((endDay.getTime() - today.getTime()) / 86400000);
    }

    _uiLang() {
        try {
            const fromDoc = document.documentElement && document.documentElement.getAttribute('lang');
            const fromLs = typeof localStorage !== 'undefined' ? localStorage.getItem('appLanguage') : null;
            const fromGlobal = typeof currentLanguage !== 'undefined' && currentLanguage
                ? String(currentLanguage)
                : '';
            return String(fromDoc || fromLs || fromGlobal || 'en').toLowerCase().split('-')[0];
        } catch (_) {
            return 'en';
        }
    }

    /** Parentheses text next to "Ends" date (safe HTML span). */
    _daysRemainingSuffix(subscription, status) {
        const ar = this._uiLang() === 'ar';
        if (status === 'Lifetime') {
            const t = ar ? '(بدون انتهاء)' : '(no expiry)';
            return ` <span class="sa-days-remain">${this._escapeHtml(t)}</span>`;
        }
        const sub = subscription || null;
        if (!sub || !sub.endDate) return '';
        const n = this._calendarDaysToEnd(sub.endDate);
        if (n === null || !Number.isFinite(n)) return '';
        let inner;
        if (ar) {
            if (n > 1) inner = `(متبقي ${n} يوم)`;
            else if (n === 1) inner = '(يوم واحد متبقي)';
            else if (n === 0) inner = '(ينتهي اليوم)';
            else {
                const ago = Math.abs(n);
                inner = ago === 1 ? '(متأخر يوم واحد)' : `(متأخر ${ago} يوم)`;
            }
        } else {
            if (n > 1) inner = `(${n} days left)`;
            else if (n === 1) inner = '(1 day left)';
            else if (n === 0) inner = '(ends today)';
            else {
                const ago = Math.abs(n);
                inner = ago === 1 ? '(1 day overdue)' : `(${ago} days overdue)`;
            }
        }
        const late = n < 0 ? ' sa-days-remain--late' : '';
        return ` <span class="sa-days-remain${late}">${this._escapeHtml(inner)}</span>`;
    }

    async loadUsers() {
        if (this.isLoading) return;
        this._renderTableMessage('loading', 'Loading admin dashboard data...');
        this._setStatusLine('Loading subscriptions, users, and admin metrics...', 'neutral');
        const access = await this._getAccessState();
        if (!access.allowed) {
            this.hideSuperAdminLink();
            this._renderBlockedState();
            if (typeof showMessage === 'function') {
                showMessage('Access denied. Super admin privileges are required.', 'error');
            }
            return;
        }
        this.showSuperAdminLink();
        this._renderCurrentBuild();
        this._updateAccessDiagnostics();

        if (access.needsBootstrap && this.db && typeof this.db.bootstrapSuperAdminAccessSecure === 'function') {
            try {
                await this.db.bootstrapSuperAdminAccessSecure();
                const fbAuth = this.auth && this.auth.auth;
                const authUser = fbAuth && fbAuth.currentUser ? fbAuth.currentUser : null;
                if (authUser && this.auth && typeof this.auth.loadUserData === 'function') {
                    await this.auth.loadUserData(authUser.uid);
                }
            } catch (bootstrapErr) {
                console.warn('Super admin bootstrap failed:', bootstrapErr);
            }
        }

        this.isLoading = true;

        try {
            this._recalculateUsageStatsBestEffort();
            const loadWithTimeout = () => Promise.race(
                [
                    this.db.adminListUsersSecure('', 300),
                    new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('Super admin users request timed out.')), 25000);
                    })
                ]
            );
            let rows = [];
            let source = 'secure_callable';
            let primaryError = null;
            try {
                rows = await loadWithTimeout();
            } catch (firstErr) {
                const firstMsg = String((firstErr && (firstErr.message || firstErr.code)) || '');
                primaryError = firstErr;
                if (/timed out/i.test(firstMsg)) {
                    // One controlled retry for cold starts / temporary network spikes.
                    rows = await loadWithTimeout();
                }
            }

            // Fallback: if secure callable is unavailable, try legacy read path
            // so the page still shows useful state instead of looking empty.
            if ((!Array.isArray(rows) || rows.length === 0) && this.db) {
                if (typeof this.db.getUsersWithSubscriptions === 'function') {
                    try {
                        rows = await this.db.getUsersWithSubscriptions();
                        source = 'legacy_firestore';
                    } catch (fallbackErr) {
                        if (!primaryError) primaryError = fallbackErr;
                    }
                } else if (typeof this.db.getAllUsers === 'function') {
                    try {
                        rows = await this.db.getAllUsers();
                        source = 'legacy_users_collection';
                    } catch (fallbackErr) {
                        if (!primaryError) primaryError = fallbackErr;
                    }
                }
            }

            if (!Array.isArray(rows)) rows = [];
            if (!rows.length && primaryError) throw primaryError;

            this.allUsers = Array.isArray(rows) ? rows : [];
            this.filteredUsers = [...this.allUsers];
            this.currentPage = 1;
            const searchInput = document.getElementById('userSearchInput');
            if (searchInput) searchInput.value = '';
            this.renderUsers();
            this.loadStatistics();
            if (!this.allUsers.length) {
                this._setStatusLine('No subscriptions found. Create/activate subscriptions to populate this dashboard.', 'neutral');
            } else {
                this._setStatusLine(`Loaded ${this.allUsers.length} account(s) from ${source}.`, 'success');
            }
        } catch (error) {
            console.error('loadUsers failed:', error);
            let details = 'Error loading users';
            const msg = String((error && (error.message || error.code)) || '');
            if (/permission|denied/i.test(msg)) {
                details = 'Permission denied. Please re-login to refresh super admin claims.';
            } else if (/timed out/i.test(msg)) {
                details = 'Request timed out. Check network or Cloud Functions deployment.';
            }
            this._renderTableMessage('error', details);
            this._setStatusLine(`Admin dashboard error: ${details}`, 'error');
            if (typeof showMessage === 'function') showMessage(details, 'error');
        } finally {
            this.isLoading = false;
        }
    }

    async _recalculateUsageStatsBestEffort() {
        if (!this.db || typeof this.db.adminRecalculateUsageStatsSecure !== 'function') return;
        const host = (typeof window !== 'undefined' && window.location && window.location.hostname)
            ? String(window.location.hostname).toLowerCase()
            : '';
        const isHostedWeb = /\.web\.app$|\.firebaseapp\.com$/.test(host);
        // Avoid noisy callable timeouts/CORS symptoms on hosted dashboard load.
        // Usage stats are still maintained by server-side scheduled recalculation.
        if (isHostedWeb) return;
        const now = Date.now();
        // Throttle backend recalculation calls to avoid noisy traffic.
        if (now - Number(this._lastUsageRecalcAt || 0) < 30 * 60 * 1000) return;
        this._lastUsageRecalcAt = now;
        try {
            // Small batch to reduce callable timeout risk on dashboard load.
            await this.db.adminRecalculateUsageStatsSecure({ limit: 50 });
        } catch (error) {
            console.warn('Usage stats recalc skipped:', error && (error.message || error.code || error));
        }
    }

    filterUsers(searchTerm) {
        const term = String(searchTerm || '').toLowerCase().trim();
        if (!term) {
            this.filteredUsers = [...this.allUsers];
        } else {
            this.filteredUsers = this.allUsers.filter((user) => {
                const name = String(user.fullName || user.name || '').toLowerCase();
                const phone = String(user.phoneE164 || user.phone || user.phoneNumber || '').toLowerCase();
                const email = String(user.email || '').toLowerCase();
                return name.includes(term) || phone.includes(term) || email.includes(term);
            });
        }
        this.currentPage = 1;
        this.renderUsers();
    }

    updateShowingCount() {
        const el = document.getElementById('superAdminShowingCount');
        if (!el) return;
        const total = this.allUsers.length;
        const showing = this._computeRows().length;
        if (!total) {
            el.textContent = '';
            return;
        }
        el.textContent = showing === total ? `Showing all ${total} users` : `Showing ${showing} of ${total} users`;
    }

    loadStatistics() {
        const stats = {
            total: this.allUsers.length,
            active: 0,
            expired: 0,
            lifetime: 0
        };

        this.allUsers.forEach((u) => {
            const status = this._subscriptionStatus(u.subscription || null);
            if (status === 'Lifetime') stats.lifetime += 1;
            else if (status === 'Active') stats.active += 1;
            else stats.expired += 1;
        });

        const setText = (id, value) => {
            const node = document.getElementById(id);
            if (node) node.textContent = String(value);
        };
        setText('totalUsersCount', stats.total);
        setText('activeUsersCount', stats.active);
        setText('expiredSubscriptionsCount', stats.expired);
        setText('lifetimeUsersCount', stats.lifetime);
    }

    _computeRows() {
        const rows = Array.isArray(this.filteredUsers) ? [...this.filteredUsers] : [];
        const filtered = rows.filter((u) => {
            if (this.statusFilter === 'all') return true;
            const status = this._subscriptionStatus(u.subscription || null);
            if (this.statusFilter === 'active') return status === 'Active' || status === 'Lifetime';
            if (this.statusFilter === 'expired') return status === 'Expired';
            return true;
        });
        const getUsageMb = (u) => {
            const stat = this._usageStatForUser(u);
            const fromMb = Number(stat && stat.megaBytes || 0);
            if (Number.isFinite(fromMb) && fromMb > 0) return fromMb;
            const fromBytes = Number(stat && stat.bytes || 0);
            if (Number.isFinite(fromBytes) && fromBytes > 0) return fromBytes / (1024 * 1024);
            return 0;
        };
        const getEndTs = (u) => {
            const end = u && u.subscription && u.subscription.endDate ? new Date(u.subscription.endDate).getTime() : 0;
            return Number.isFinite(end) ? end : 0;
        };
        filtered.sort((a, b) => {
            let va;
            let vb;
            if (this.sortKey === 'megaBytes') {
                va = getUsageMb(a); vb = getUsageMb(b);
            } else if (this.sortKey === 'endDate') {
                va = getEndTs(a); vb = getEndTs(b);
            } else {
                va = String(a.fullName || a.name || '').toLowerCase();
                vb = String(b.fullName || b.name || '').toLowerCase();
            }
            if (va < vb) return this.sortDirection === 'asc' ? -1 : 1;
            if (va > vb) return this.sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
        return filtered;
    }

    _changePage(delta) {
        const rows = this._computeRows();
        const totalPages = Math.max(1, Math.ceil(rows.length / this.pageSize));
        this.currentPage = Math.min(totalPages, Math.max(1, this.currentPage + delta));
        this.renderUsers();
    }

    _renderPagination(totalRows) {
        const totalPages = Math.max(1, Math.ceil(totalRows / this.pageSize));
        if (this.currentPage > totalPages) this.currentPage = totalPages;
        const pageInfo = document.getElementById('saPageInfo');
        if (pageInfo) pageInfo.textContent = `Page ${this.currentPage} / ${totalPages}`;
        const prevBtn = document.getElementById('saPrevPageBtn');
        if (prevBtn) prevBtn.disabled = this.currentPage <= 1;
        const nextBtn = document.getElementById('saNextPageBtn');
        if (nextBtn) nextBtn.disabled = this.currentPage >= totalPages;
    }

    renderUsers() {
        const root = this._tableBodyRoot();
        if (!root) return;
        try {
            const rows = this._computeRows();
            this._renderPagination(rows.length);
            if (!rows.length) {
                root.innerHTML = `
                    <tr><td colspan="6"><div class="sa-user-card sa-user-card--message sa-user-card--empty"><p>No subscriptions found</p></div></td></tr>
                `;
                this.updateShowingCount();
                return;
            }

            const start = (this.currentPage - 1) * this.pageSize;
            const pageRows = rows.slice(start, start + this.pageSize);

            root.innerHTML = pageRows.map((user) => {
                const uid = this._escapeHtml(user.id || user.uid || '');
                const name = this._escapeHtml(user.fullName || user.name || '—');
                const email = this._escapeHtml(user.email || '—');
                const phone = this._escapeHtml(user.phoneE164 || user.phone || user.phoneNumber || '—');
                const status = this._subscriptionStatus(user.subscription || null);
                const usage = this._formatUsage(this._usageStatForUser(user));
                const endDate = this._formatDate(user.subscription && user.subscription.endDate);
                return `
                    <tr data-uid="${uid}">
                        <td>
                            <div class="sa-user-main">
                                <div class="sa-user-name">${name}</div>
                                <div class="sa-user-email" dir="ltr">${email}</div>
                            </div>
                        </td>
                        <td dir="ltr">${phone}</td>
                        <td>
                            ${this._statusBadge(status)}
                        </td>
                        <td><span class="data-size-badge">${usage}</span></td>
                        <td dir="ltr">${status === 'Lifetime' ? '∞' : this._escapeHtml(endDate)}</td>
                        <td>
                            <details class="sa-actions-menu">
                                <summary title="Actions">⋮</summary>
                                <div class="sa-actions-menu__list">
                                    <button type="button" data-action="activate" data-uid="${uid}">Activate</button>
                                    <button type="button" data-action="deactivate" data-uid="${uid}">Deactivate</button>
                                    <button type="button" data-action="addDays" data-uid="${uid}">Add Time</button>
                                    <button type="button" data-action="lifetime" data-uid="${uid}">Lifetime</button>
                                    <button type="button" data-action="deleteAccount" data-uid="${uid}">Delete Account</button>
                                </div>
                            </details>
                        </td>
                    </tr>
                `;
            }).join('');

            this.updateShowingCount();
        } catch (renderError) {
            console.error('renderUsers failed:', renderError);
            this._renderTableMessage('error', 'Failed to render admin dashboard data.');
            this._setStatusLine('Render error: some user rows contain invalid data.', 'error');
        }
    }

    _renderCurrentBuild() {
        const appVersionEl = document.getElementById('saCurrentAppVersion');
        if (!appVersionEl) return;
        const meta = (window.__APP_BUILD_META && typeof window.__APP_BUILD_META === 'object')
            ? window.__APP_BUILD_META
            : {};
        const appVersion = String(meta.appVersion || meta.version || window.__APP_VERSION_LABEL || '1.0.0').trim() || '1.0.0';
        appVersionEl.textContent = appVersion;
    }

    async ensureAppVersionBaseline() {
        if (!this._isTestEnvironment()) return;
        if (!this.db || typeof this.db.adminNormalizeAppVersionBaselineSecure !== 'function') return;
        try {
            await this.db.adminNormalizeAppVersionBaselineSecure({});
        } catch (error) {
            console.warn('ensureAppVersionBaseline failed:', error);
        }
    }

    _isDeploymentStatusLoading() {
        return !!this._deploymentStatusLoading;
    }

    _getOfficialAppVersionLabel(state) {
        const raw = (state && state.releasedVersionLabel) || window.__APP_RELEASED_VERSION_LABEL || '1.0.0';
        if (typeof normalizeSemverLabelClient === 'function') {
            return normalizeSemverLabelClient(raw) || '1.0.0';
        }
        return String(raw || '1.0.0').trim() || '1.0.0';
    }

    _getSuggestedNextAppVersionLabel(state) {
        const latest = this._getOfficialAppVersionLabel(state);
        if (typeof bumpPatchSemverLabel === 'function') {
            return bumpPatchSemverLabel(latest);
        }
        return latest;
    }

    _buildNumber(build) {
        return Math.max(0, Number(build && (build.scriptVersion || build.buildId) || 0) || 0);
    }

    _isTestEnvironment() {
        if (window.__APP_ENV_IS_TEST === true) return true;
        if (String(window.__APP_ENV || '').toLowerCase() === 'test') return true;
        const host = String((window.location && window.location.hostname) || '').toLowerCase();
        return host.includes('pos-catch-test') || host.includes('localhost') || host === '127.0.0.1';
    }

    _shouldShowDeploymentPanel() {
        return this._hasSuperAdminAccess() && this._isTestEnvironment();
    }

    _getUrlBuildHint() {
        try {
            const value = Number(new URLSearchParams(window.location.search).get('__app_build') || 0) || 0;
            return value > 0 ? value : 0;
        } catch (_) {
            return 0;
        }
    }

    _getLocalTestBuildMeta() {
        const meta = (window.__APP_BUILD_META && typeof window.__APP_BUILD_META === 'object')
            ? window.__APP_BUILD_META
            : null;
        if (meta && this._buildNumber(meta) > 0) {
            return this._normalizeClientBuildManifest(meta, 'test');
        }
        const urlBuild = this._getUrlBuildHint();
        if (urlBuild > 0) {
            return this._normalizeClientBuildManifest({
                buildId: String(urlBuild),
                scriptVersion: urlBuild,
                environment: 'test'
            }, 'test');
        }
        return null;
    }

    _formatBuildLabel(build) {
        const code = this._buildNumber(build);
        return code > 0 ? String(code) : 'Unavailable';
    }

    _missingDeploymentMessage() {
        return 'Cannot promote or release because build metadata is missing.';
    }

    _normalizeClientBuildManifest(raw, envFallback) {
        if (!raw || typeof raw !== 'object') return null;
        const scriptVersion = this._buildNumber(raw);
        const buildId = String(raw.buildId || scriptVersion || '').trim();
        if (!buildId && !scriptVersion) return null;
        const appVersion = String(raw.version || raw.appVersion || '').trim();
        const environment = String(raw.environment || raw.env || envFallback || '').trim().toLowerCase();
        return {
            buildId: buildId || String(scriptVersion),
            appVersion,
            version: appVersion,
            scriptVersion: scriptVersion || Number(buildId) || 0,
            cssVersion: Math.max(0, Number(raw.cssVersion || 0) || 0),
            deployedAt: String(raw.deployedAt || '').trim(),
            environment: environment || envFallback,
            env: environment || envFallback,
            commit: String(raw.commit || '').trim()
        };
    }

    async _fetchClientBuildManifest(hostBase, envFallback) {
        const base = String(hostBase || '').replace(/\/+$/, '');
        if (!base) return null;
        const bust = Date.now();
        try {
            const manifestRes = await fetch(`${base}/build-manifest.json?_=${bust}`, { cache: 'no-store' });
            if (manifestRes.ok) {
                const text = (await manifestRes.text()).trim();
                if (text.startsWith('{')) {
                    const normalized = this._normalizeClientBuildManifest(JSON.parse(text), envFallback);
                    if (normalized) return normalized;
                }
            }
            const indexRes = await fetch(`${base}/index.html?_=${bust}`, { cache: 'no-store' });
            if (indexRes.ok) {
                const html = await indexRes.text();
                const match = html.match(/window\.__APP_BUILD_META\s*=\s*(\{[\s\S]*?\});/);
                if (match) {
                    const normalized = this._normalizeClientBuildManifest(JSON.parse(match[1]), envFallback);
                    if (normalized) return normalized;
                }
                const scriptMatch = html.match(/script\.js\?v=(\d+)/i);
                if (scriptMatch) {
                    const scriptVersion = Number(scriptMatch[1] || 0) || 0;
                    if (scriptVersion > 0) {
                        return this._normalizeClientBuildManifest({
                            buildId: String(scriptVersion),
                            scriptVersion,
                            environment: envFallback
                        }, envFallback);
                    }
                }
            }
        } catch (_) {}
        return null;
    }

    _evaluateDeploymentClient(data) {
        const payload = data && typeof data === 'object' ? { ...data } : {};
        const test = payload.test || null;
        const prod = payload.prod || null;
        const approved = payload.latestApprovedBuild || test || null;
        const testBuild = this._buildNumber(test);
        const prodBuild = this._buildNumber(prod);
        const approvedBuild = this._buildNumber(approved);
        const buildMetadataAvailable = testBuild > 0 && prodBuild > 0 && approvedBuild > 0;
        const buildsAligned = testBuild === prodBuild && prodBuild === approvedBuild;
        const promotionRequired = buildMetadataAvailable && testBuild > prodBuild;
        const releaseAllowed = buildMetadataAvailable && buildsAligned;
        const promoteAllowed = testBuild > 0 && prodBuild > 0 && testBuild > prodBuild;

        let statusMessage = 'Build information unavailable. Cannot verify production deployment.';
        let promoteMessage = this._missingDeploymentMessage();
        if (buildMetadataAvailable) {
            if (promotionRequired) {
                statusMessage = `Promote TEST build ${testBuild} to Production before releasing to users.`;
                promoteMessage = `Clone TEST build ${testBuild} to Production (current: ${prodBuild}).`;
            } else if (!buildsAligned) {
                statusMessage = `Build mismatch. TEST ${testBuild}, Production ${prodBuild}, Approved ${approvedBuild}.`;
                promoteMessage = 'Production already has the latest TEST build.';
            } else {
                statusMessage = 'Production matches approved TEST build. You can release to users.';
                promoteMessage = 'Production already has the latest TEST build.';
            }
        } else {
            promoteMessage = this._missingDeploymentMessage();
        }

        return {
            ...payload,
            test,
            prod,
            latestApprovedBuild: approved,
            buildMetadataAvailable,
            promotionRequired,
            releaseAllowed,
            promoteAllowed,
            statusMessage,
            promoteMessage
        };
    }

    _renderDeploymentPanel(status) {
        const panel = document.getElementById('saDeployPanel');
        if (!panel) return;
        if (!this._shouldShowDeploymentPanel()) {
            panel.style.display = 'none';
            panel.classList.remove('sa-deploy-panel--error');
            return;
        }
        panel.style.display = '';
        const data = this._evaluateDeploymentClient(status || this._deploymentStatus || {});
        const testBuild = data.test || null;
        const prodBuild = data.prod || null;
        const approved = data.latestApprovedBuild || testBuild || null;
        const envEl = document.getElementById('saDeployEnvironment');
        const testEl = document.getElementById('saTestBuildId');
        const prodEl = document.getElementById('saProdBuildId');
        const approvedEl = document.getElementById('saApprovedBuildId');
        const hintEl = document.getElementById('saDeployStatusHint');
        const promoteBtn = document.getElementById('saPromoteTestBuildBtn');
        if (envEl) envEl.textContent = `Environment: ${String(data.environment || 'TEST').toUpperCase()}`;
        const showUnavailable = !data.buildMetadataAvailable;
        if (testEl) testEl.textContent = showUnavailable ? 'Unavailable' : this._formatBuildLabel(testBuild);
        if (prodEl) prodEl.textContent = showUnavailable ? 'Unavailable' : this._formatBuildLabel(prodBuild);
        if (approvedEl) approvedEl.textContent = showUnavailable ? 'Unavailable' : this._formatBuildLabel(approved);
        panel.classList.toggle('sa-deploy-panel--error', !data.buildMetadataAvailable);
        if (hintEl) {
            hintEl.textContent = data.buildMetadataAvailable
                ? (data.statusMessage || '')
                : 'Build information unavailable. Cannot verify production deployment.';
        }
        if (promoteBtn) {
            const canPromote = !!data.promoteAllowed && !this._promoteInFlight;
            promoteBtn.disabled = !canPromote;
            if (!this._promoteInFlight) {
                promoteBtn.innerHTML = SA_PROMOTE_BTN_HTML;
            }
            promoteBtn.title = canPromote
                ? (data.promoteMessage || 'Clone the live TEST hosting version to Production')
                : (data.promoteMessage || this._missingDeploymentMessage());
        }
    }

    async _mergeDeploymentSources(apiData) {
        const TEST_HOST = 'https://pos-catch-test.web.app';
        const PROD_HOST = 'https://pos-catch.web.app';
        const data = (apiData && typeof apiData === 'object') ? apiData : {};
        const test = data.test
            || this._getLocalTestBuildMeta()
            || await this._fetchClientBuildManifest(TEST_HOST, 'test');
        const prod = data.prod || await this._fetchClientBuildManifest(PROD_HOST, 'production');
        const merged = {
            ...data,
            environment: data.environment || 'test',
            test,
            prod,
            latestApprovedBuild: data.latestApprovedBuild || test || null
        };
        return this._evaluateDeploymentClient(merged);
    }

    async loadDeploymentStatus() {
        if (this._deploymentStatusLoadPromise) return this._deploymentStatusLoadPromise;
        this._deploymentStatusLoadPromise = this._loadDeploymentStatusInner();
        try {
            return await this._deploymentStatusLoadPromise;
        } finally {
            this._deploymentStatusLoadPromise = null;
        }
    }

    async _loadDeploymentStatusInner() {
        if (!this._hasSuperAdminAccess() || !this._isTestEnvironment()) {
            this._deploymentStatusLoading = false;
            this._deploymentStatusLoaded = true;
            this._renderDeploymentPanel(this._deploymentStatus);
            this._refreshReleaseFormValidation();
            return;
        }
        const TEST_HOST = 'https://pos-catch-test.web.app';
        const PROD_HOST = 'https://pos-catch.web.app';
        const loadSeq = ++this._deploymentStatusLoadSeq;
        this._deploymentStatusLoading = true;
        this._refreshReleaseFormValidation();
        try {
            let apiData = null;
            if (this.db && typeof this.db.adminGetDeploymentStatusSecure === 'function') {
                apiData = await this.db.adminGetDeploymentStatusSecure({});
            }
            if (loadSeq !== this._deploymentStatusLoadSeq) return;
            this._deploymentStatus = await this._mergeDeploymentSources(apiData);
        } catch (error) {
            console.error('loadDeploymentStatus failed:', error);
            try {
                this._deploymentStatus = await this._mergeDeploymentSources({
                    environment: 'test',
                    test: this._getLocalTestBuildMeta() || await this._fetchClientBuildManifest(TEST_HOST, 'test'),
                    prod: await this._fetchClientBuildManifest(PROD_HOST, 'production')
                });
            } catch (_) {
                this._deploymentStatus = this._evaluateDeploymentClient({
                    environment: 'test',
                    test: this._getLocalTestBuildMeta(),
                    prod: null,
                    latestApprovedBuild: this._getLocalTestBuildMeta()
                });
            }
        } finally {
            if (loadSeq !== this._deploymentStatusLoadSeq) return;
            this._deploymentStatusLoading = false;
            this._deploymentStatusLoaded = true;
            this._renderDeploymentPanel(this._deploymentStatus);
            this._refreshReleaseFormValidation();
        }
    }

    async promoteTestBuildToProduction() {
        if (!(await this._guardAccess())) return;
        if (this._promoteInFlight) return;
        if (!this.db || typeof this.db.adminPromoteTestBuildToProductionSecure !== 'function') {
            if (typeof showMessage === 'function') showMessage('Promotion API is unavailable.', 'error');
            return;
        }
        const promoteBtn = document.getElementById('saPromoteTestBuildBtn');
        const testBuild = (this._deploymentStatus && this._deploymentStatus.test) ? this._deploymentStatus.test : {};
        const ok = window.confirm(`Promote TEST build ${testBuild.scriptVersion || '-'} to Production?\n\nThis clones the exact live TEST hosting files to pos-catch.web.app.`);
        if (!ok) return;
        this._promoteInFlight = true;
        if (promoteBtn) {
            promoteBtn.disabled = true;
            promoteBtn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Promoting...';
        }
        try {
            const result = await this.db.adminPromoteTestBuildToProductionSecure({});
            await this.loadDeploymentStatus();
            const deployment = this._evaluateDeploymentClient(this._deploymentStatus || {});
            const testBuild = this._buildNumber(deployment.test);
            const prodBuild = this._buildNumber(deployment.prod);
            const approvedBuild = this._buildNumber(deployment.latestApprovedBuild);
            const verified = !!(result && result.verified) && testBuild > 0 && testBuild === prodBuild && prodBuild === approvedBuild;
            if (!verified) {
                const msg = `Promotion did not verify on Production. TEST ${testBuild || '-'}, Production ${prodBuild || '-'}, Approved ${approvedBuild || '-'}.`;
                if (typeof showMessage === 'function') showMessage(msg, 'error');
                return;
            }
            const msg = String((result && result.message) || `Production build ${prodBuild} verified on build-manifest.json.`);
            if (typeof showMessage === 'function') showMessage(msg, 'success');
        } catch (error) {
            console.error('promoteTestBuildToProduction failed:', error);
            if (typeof showMessage === 'function') showMessage(this._mapReleaseUpdateError(error), 'error');
            await this.loadDeploymentStatus();
        } finally {
            this._promoteInFlight = false;
            if (promoteBtn) {
                promoteBtn.innerHTML = SA_PROMOTE_BTN_HTML;
            }
            this._renderDeploymentPanel(this._deploymentStatus);
            this._refreshReleaseFormValidation();
        }
    }

    _renderUpdateControl(state) {
        this._lastUpdateControlState = state || {};
        this._renderCurrentBuild();
        this._syncReleaseVersionSuggestion(state || {});
        this._onUpdateRolloutModeChange();
        const releasedEl = document.getElementById('saReleasedVersion');
        const nextVersionEl = document.getElementById('saNextVersionLabel');
        const newUpdateEl = document.getElementById('saNewUpdateStatus');
        const testModeEl = document.getElementById('saTestModeStatus');
        const changelogEl = document.getElementById('saReleaseChangelogPreview');
        const latestAppVersion = this._getOfficialAppVersionLabel(state || {});
        const nextAppVersion = this._getSuggestedNextAppVersionLabel(state || {});
        if (releasedEl) releasedEl.textContent = latestAppVersion;
        if (nextVersionEl) nextVersionEl.textContent = nextAppVersion;
        const currentAppVersion = String(
            (window.__APP_BUILD_META && (window.__APP_BUILD_META.appVersion || window.__APP_BUILD_META.version))
            || window.__APP_VERSION_LABEL
            || '1.0.0'
        ).trim() || '1.0.0';
        const hasNew = typeof compareSemverLabels === 'function'
            ? compareSemverLabels(currentAppVersion, latestAppVersion) > 0
            : false;
        if (newUpdateEl) {
            newUpdateEl.textContent = hasNew ? `Ready (${currentAppVersion})` : 'No new update';
        }
        if (testModeEl) {
            testModeEl.textContent = 'Active';
        }
        if (changelogEl) {
            const notes = Array.isArray(state && state.changelog)
                ? state.changelog
                : (Array.isArray(state && state.pendingChangelog) ? state.pendingChangelog : []);
            changelogEl.textContent = notes.length
                ? `What's New: ${notes.slice(0, 3).join(' | ')}${notes.length > 3 ? ` | +${notes.length - 3} more` : ''}`
                : `What's New: -`;
        }
        if (!this._deploymentStatusLoading) {
            this._refreshReleaseFormValidation();
        }
        this._renderDeploymentPanel(this._deploymentStatus);
    }

    _productionPromotionRequired() {
        const data = this._evaluateDeploymentClient(this._deploymentStatus || {});
        return !!data.promotionRequired;
    }

    _releaseAllowedByDeployment() {
        const data = this._evaluateDeploymentClient(this._deploymentStatus || {});
        return !!data.releaseAllowed;
    }

    _getLatestApprovedBuildMeta() {
        const data = this._deploymentStatus || {};
        return data.prod || data.latestApprovedBuild || data.test || null;
    }

    _getLatestReleasedVersionLabel() {
        return this._getOfficialAppVersionLabel(this._lastUpdateControlState || {});
    }

    _syncReleaseVersionSuggestion(state) {
        const labelEl = document.getElementById('saUpdateVersionLabel');
        if (!labelEl || document.activeElement === labelEl) return;
        const suggested = this._getSuggestedNextAppVersionLabel(state || {});
        labelEl.value = suggested;
        labelEl.placeholder = `e.g. ${suggested}`;
    }

    _validateReleaseDraft(draft) {
        if (this._isTestEnvironment() && this._isDeploymentStatusLoading()) {
            return { ok: false, code: 'deployment_loading', message: 'Loading deployment status. Release is disabled until build verification completes.' };
        }

        if (this._isTestEnvironment()) {
            const deployment = this._evaluateDeploymentClient(this._deploymentStatus || {});
            if (!deployment.buildMetadataAvailable) {
                return { ok: false, code: 'deployment_metadata', message: this._missingDeploymentMessage() };
            }
            if (deployment.promotionRequired) {
                const testBuild = this._buildNumber(deployment.test);
                return {
                    ok: false,
                    code: 'promotion_required',
                    message: `Promote TEST build ${testBuild || 'Unavailable'} to Production before releasing to users.`
                };
            }
            if (!deployment.releaseAllowed) {
                return {
                    ok: false,
                    code: 'deployment_mismatch',
                    message: deployment.statusMessage || 'Build information unavailable. Cannot verify production deployment.'
                };
            }
        }

        const latest = this._getLatestReleasedVersionLabel();
        const versionLabel = typeof normalizeSemverLabelClient === 'function'
            ? normalizeSemverLabelClient(draft && draft.versionLabel)
            : String((draft && draft.versionLabel) || '').trim();
        if (!versionLabel) {
            return { ok: false, code: 'invalid_version', message: 'Invalid version format. Use format like 1.0.1.' };
        }
        const cmp = typeof compareSemverLabels === 'function'
            ? compareSemverLabels(versionLabel, latest)
            : 0;
        if (cmp <= 0) {
            return { ok: false, code: 'invalid_version', message: 'New version must be higher than latest app version. Example: 1.0.1' };
        }
        if (draft && draft.target === 'selected_users' && (!draft.userIds || !draft.userIds.length)) {
            return { ok: false, code: 'missing_users', message: 'Please select at least one user.' };
        }
        if (!draft || !draft.changelog || !draft.changelog.length) {
            return { ok: false, code: 'missing_changelog', message: 'Please add at least one changelog item.' };
        }
        return { ok: true, message: '', versionLabel };
    }

    _refreshReleaseFormValidation() {
        const releaseBtn = document.getElementById('saReleaseUpdateBtn');
        const hintEl = document.getElementById('saReleaseValidationHint');
        if (!releaseBtn) return;
        if (this._releaseInFlight) {
            releaseBtn.disabled = true;
            releaseBtn.setAttribute('aria-disabled', 'true');
            releaseBtn.classList.add('is-disabled');
            if (hintEl) {
                hintEl.textContent = '';
                hintEl.style.display = 'none';
            }
            return;
        }
        const draft = this._collectReleaseDraftFromUi();
        const validation = this._validateReleaseDraft(draft);
        const releaseEnabled = !!validation.ok;
        releaseBtn.disabled = !releaseEnabled;
        releaseBtn.setAttribute('aria-disabled', releaseEnabled ? 'false' : 'true');
        releaseBtn.classList.toggle('is-disabled', !releaseEnabled);
        if (hintEl) {
            if (!releaseEnabled && validation.message) {
                hintEl.textContent = validation.message;
                hintEl.style.display = '';
            } else {
                hintEl.textContent = '';
                hintEl.style.display = 'none';
            }
        }
    }

    _mapReleaseUpdateError(err) {
        const msg = String(err && err.message || err || '').trim();
        const code = String(err && err.code || '');
        if (/Production deploy required|Promote TEST build|Build information unavailable|Cannot promote or release/i.test(msg)) return msg;
        if (/Production deploy failed/i.test(msg)) return msg;
        if (/Please select at least one user/i.test(msg)) return 'Please select at least one user.';
        if (/changelog/i.test(msg) && /required|add|least one/i.test(msg)) return 'Please add at least one changelog item.';
        if (/greater than|higher than|must be higher/i.test(msg)) return 'Version must be greater than latest version.';
        if (/semantic version|valid version|Invalid version/i.test(msg)) return 'Invalid version format. Use format like 1.0.1.';
        if (/No update is ready|No pending version/i.test(msg)) return msg;
        if (/not authorized|permission-denied|not allowed/i.test(msg) || code === 'permission-denied') {
            return 'You are not allowed to release updates from this account.';
        }
        if (typeof mapPublishUpdateError === 'function') {
            const mapped = mapPublishUpdateError(err);
            if (mapped && mapped !== 'Could not publish the update. Please try again.') return mapped;
        }
        if (msg) return msg;
        return 'Could not release the update. Please try again.';
    }

    async loadSimpleUpdateStats() {
        const updatedEl = document.getElementById('saUpdatedUsersCount');
        if (!updatedEl) return;
        if (!this.db || typeof this.db.adminGetUpdateStatusDashboardSecure !== 'function') {
            updatedEl.textContent = '-';
            return;
        }
        try {
            const data = await this.db.adminGetUpdateStatusDashboardSecure({});
            const summary = (data && data.summary) ? data.summary : {};
            updatedEl.textContent = String(summary.installedRatio || '-');
        } catch (_) {
            updatedEl.textContent = '-';
        }
    }

    _collectReleaseDraftFromUi() {
        const changelogRaw = String((document.getElementById('saUpdateChangelog') || {}).value || '').trim();
        const changelog = changelogRaw
            ? changelogRaw.split('\n').map((row) => String(row || '').trim()).filter(Boolean)
            : [];
        const labelEl = document.getElementById('saUpdateVersionLabel');
        const versionLabel = String(labelEl && labelEl.value || '').trim();
        const modeEl = document.getElementById('saUpdateRolloutMode');
        const isTargeted = modeEl && modeEl.value === 'targeted';
        const targetIds = Array.from(this._updateTargetUserIds || new Set()).filter(Boolean);
        const target = isTargeted ? 'selected_users' : 'all';
        const rollout = isTargeted && targetIds.length
            ? {
                mode: 'targeted',
                userIds: targetIds,
                ownerIds: targetIds,
                tenantIds: [],
                rolloutPercent: 100
            }
            : {
                mode: 'global',
                rolloutPercent: 100
            };
        return {
            versionLabel,
            changelog,
            target,
            userIds: isTargeted ? targetIds : [],
            rollout,
            backupId: `backup_${Date.now()}`,
            backupStorageHint: 'auto'
        };
    }

    _formatUsage(stat) {
        const bytes = Number(stat && stat.bytes || 0);
        if (!bytes || !Number.isFinite(bytes)) return '0 MB';
        if (bytes < 1024) return `${bytes} B`;
        const kb = bytes / 1024;
        if (kb < 1024) return `${kb.toFixed(kb < 10 ? 2 : 1)} KB`;
        const mb = bytes / (1024 * 1024);
        if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
        return `${mb.toFixed(2)} MB`;
    }

    async loadFeatureFlagsSummary() {
        const summaryEl = document.getElementById('saFeatureFlagsSummary');
        const listEl = document.getElementById('saFeatureFlagsList');
        if (!summaryEl) return;
        if (!this.db || typeof this.db.getFeatureFlagsControl !== 'function') {
            summaryEl.textContent = 'Feature flags API is unavailable.';
            if (listEl) listEl.textContent = 'Feature flags API is unavailable.';
            return;
        }
        try {
            const payload = await this.db.getFeatureFlagsControl();
            const flags = payload && payload.featureFlags && typeof payload.featureFlags === 'object'
                ? payload.featureFlags
                : {};
            this.featureFlagsCache = flags;
            const keys = Object.keys(flags);
            if (!keys.length) {
                summaryEl.textContent = 'No feature flags configured.';
                if (listEl) listEl.textContent = 'No rollout rules yet.';
                return;
            }
            const preview = keys.slice(0, 5).map((k) => {
                const mode = String((flags[k] && flags[k].mode) || 'off');
                return `${k}:${mode}`;
            }).join(' | ');
            summaryEl.textContent = keys.length > 5
                ? `${preview} | +${keys.length - 5} more`
                : preview;
            this.renderFeatureFlagsList(flags);
        } catch (error) {
            console.error('loadFeatureFlagsSummary failed:', error);
            summaryEl.textContent = 'Failed to load feature flags.';
            if (listEl) listEl.textContent = 'Failed to load rollout rules.';
        }
    }

    renderFeatureFlagsList(flagsMap) {
        const listEl = document.getElementById('saFeatureFlagsList');
        if (!listEl) return;
        const flags = (flagsMap && typeof flagsMap === 'object') ? flagsMap : {};
        const keys = Object.keys(flags).sort((a, b) => a.localeCompare(b));
        if (!keys.length) {
            listEl.textContent = 'No rollout rules yet.';
            return;
        }
        listEl.innerHTML = keys.map((k) => {
            const rule = flags[k] || {};
            const mode = String(rule.mode || 'off');
            const users = Array.isArray(rule.userIds) ? rule.userIds : [];
            const owners = Array.isArray(rule.ownerIds) ? rule.ownerIds : [];
            const count = new Set([...users, ...owners]).size;
            return `
                <div class="sa-flag-row" data-flag-key="${this._escapeHtml(k)}">
                    <div class="sa-flag-row__main">
                        <strong>${this._escapeHtml(k)}</strong>
                        <span class="sa-flag-pill">${this._escapeHtml(mode)}</span>
                        <span class="sa-minimal-count">Targets: ${count}</span>
                    </div>
                    <div class="sa-flag-row__actions">
                        <button type="button" class="sa-minimal-refresh" data-action="edit-flag" data-flag-key="${this._escapeHtml(k)}">Edit</button>
                        <button type="button" class="sa-minimal-refresh" data-action="admin-only-flag" data-flag-key="${this._escapeHtml(k)}">Admin only</button>
                        <button type="button" class="sa-minimal-refresh" data-action="global-flag" data-flag-key="${this._escapeHtml(k)}">Global</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    _handleFeatureFlagsListClick(event) {
        const btn = event.target && event.target.closest ? event.target.closest('button[data-action][data-flag-key]') : null;
        if (!btn) return;
        const action = String(btn.getAttribute('data-action') || '');
        const key = String(btn.getAttribute('data-flag-key') || '').trim();
        if (!key) return;
        if (action === 'edit-flag') {
            const keyEl = document.getElementById('saFeatureFlagKey');
            const modeEl = document.getElementById('saFeatureFlagMode');
            const targetsEl = document.getElementById('saFeatureFlagTargets');
            const rule = (this.featureFlagsCache && this.featureFlagsCache[key]) ? this.featureFlagsCache[key] : {};
            const mode = String((rule && rule.mode) || 'super_admin_only');
            const picks = []
                .concat(Array.isArray(rule.userIds) ? rule.userIds : [])
                .concat(Array.isArray(rule.ownerIds) ? rule.ownerIds : []);
            if (keyEl) keyEl.value = key;
            if (modeEl) modeEl.value = mode;
            if (targetsEl) targetsEl.value = Array.from(new Set(picks)).join(', ');
            return;
        }
        if (action === 'admin-only-flag') {
            this.db.setFeatureFlagConfig(key, { mode: 'super_admin_only' })
                .then(() => this.loadFeatureFlagsSummary())
                .catch((err) => {
                    console.error('admin-only-flag failed:', err);
                    if (typeof showMessage === 'function') showMessage('Failed to set admin-only mode.', 'error');
                });
            return;
        }
        if (action === 'global-flag') {
            this.db.setFeatureFlagConfig(key, { mode: 'global' })
                .then(() => this.loadFeatureFlagsSummary())
                .catch((err) => {
                    console.error('global-flag failed:', err);
                    if (typeof showMessage === 'function') showMessage('Failed to set global mode.', 'error');
                });
        }
    }

    async saveFeatureFlagFromUi() {
        if (!(await this._guardAccess())) return;
        const keyEl = document.getElementById('saFeatureFlagKey');
        const modeEl = document.getElementById('saFeatureFlagMode');
        const targetsEl = document.getElementById('saFeatureFlagTargets');
        const key = String(keyEl && keyEl.value || '').trim();
        const mode = String(modeEl && modeEl.value || 'super_admin_only').trim();
        if (!key) {
            if (typeof showMessage === 'function') showMessage('Feature key is required.', 'error');
            return;
        }
        const targetsRaw = String(targetsEl && targetsEl.value || '').trim();
        const targetList = targetsRaw
            ? targetsRaw.split(',').map((v) => String(v || '').trim()).filter(Boolean)
            : [];
        const config = { mode };
        if (mode === 'allow_list') {
            config.ownerIds = targetList;
            config.userIds = targetList;
        }
        try {
            await this.db.setFeatureFlagConfig(key, config);
            if (typeof showMessage === 'function') showMessage(`Feature flag "${key}" saved (${mode}).`, 'success');
            await this.loadFeatureFlagsSummary();
        } catch (error) {
            console.error('saveFeatureFlagFromUi failed:', error);
            if (typeof showMessage === 'function') showMessage('Failed to save feature flag.', 'error');
        }
    }

    openFeatureTargetsModal() {
        this._ensureTargetPickerModals();
        const modal = document.getElementById('saFeatureTargetsModal');
        const targetsEl = document.getElementById('saFeatureFlagTargets');
        if (!modal || !targetsEl) return;
        const prefill = String(targetsEl.value || '').trim();
        this._featureTargetsDraft = new Set(
            prefill ? prefill.split(',').map((v) => String(v || '').trim()).filter(Boolean) : []
        );
        const searchEl = document.getElementById('saFeatureTargetsSearch');
        if (searchEl) searchEl.value = '';
        this.renderFeatureTargetsOptions();
        this._updateTargetModalCount('saFeatureTargetsModalCount', this._featureTargetsDraft);
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        setTimeout(() => {
            const searchElNow = document.getElementById('saFeatureTargetsSearch');
            if (searchElNow && typeof searchElNow.focus === 'function') {
                try { searchElNow.focus(); } catch (_) {}
            }
        }, 10);
    }

    closeFeatureTargetsModal() {
        const modal = document.getElementById('saFeatureTargetsModal');
        if (!modal) return;
        const activeEl = document.activeElement;
        if (activeEl && modal.contains(activeEl) && typeof activeEl.blur === 'function') {
            try { activeEl.blur(); } catch (_) {}
        }
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        const opener = document.getElementById('saPickFeatureTargetsBtn');
        if (opener && typeof opener.focus === 'function') {
            try { opener.focus(); } catch (_) {}
        }
    }

    renderFeatureTargetsOptions() {
        const root = document.getElementById('saFeatureTargetsOptions');
        if (!root) return;
        const filtered = this._filterUsersForTargetPicker('saFeatureTargetsSearch');
        if (!filtered.length) {
            root.innerHTML = '<p class="sa-minimal-count">No users found.</p>';
            this._updateTargetModalCount('saFeatureTargetsModalCount', this._featureTargetsDraft);
            return;
        }
        root.innerHTML = filtered.map((u) => {
            const uid = String(u.id || u.uid || '').trim();
            const checked = this._featureTargetsDraft.has(uid) ? 'checked' : '';
            return this._buildTargetOptionHtml(u, uid, checked, 'data-target-uid');
        }).join('');
        this._bindTargetOptionCheckboxes(root, 'data-target-uid', this._featureTargetsDraft, () => {
            this._updateTargetModalCount('saFeatureTargetsModalCount', this._featureTargetsDraft);
        });
        this._updateTargetModalCount('saFeatureTargetsModalCount', this._featureTargetsDraft);
    }

    _selectVisibleFeatureTargets() {
        const filtered = this._filterUsersForTargetPicker('saFeatureTargetsSearch');
        filtered.forEach((u) => {
            const uid = String(u.id || u.uid || '').trim();
            if (uid) this._featureTargetsDraft.add(uid);
        });
        this.renderFeatureTargetsOptions();
    }

    _clearAllFeatureTargets() {
        this._featureTargetsDraft.clear();
        this.renderFeatureTargetsOptions();
    }

    applyFeatureTargetsFromModal() {
        const targetsEl = document.getElementById('saFeatureFlagTargets');
        if (!targetsEl) return;
        targetsEl.value = Array.from(this._featureTargetsDraft).join(', ');
        const modeEl = document.getElementById('saFeatureFlagMode');
        if (modeEl && targetsEl.value.trim()) modeEl.value = 'allow_list';
        this.closeFeatureTargetsModal();
    }

    _onUpdateRolloutModeChange() {
        const modeEl = document.getElementById('saUpdateRolloutMode');
        const pickBtn = document.getElementById('saUpdatePickTargetsBtn');
        const countEl = document.getElementById('saUpdateTargetsCount');
        if (!modeEl || !pickBtn || !countEl) return;
        const isTargeted = modeEl.value === 'targeted';
        pickBtn.style.display = isTargeted ? '' : 'none';
        countEl.style.display = isTargeted ? '' : 'none';
        if (!isTargeted) this._updateTargetUserIds.clear();
        this._updateUpdateTargetsCount();
        this._refreshReleaseFormValidation();
    }

    openUpdateTargetsModal() {
        this._ensureTargetPickerModals();
        const modal = document.getElementById('saUpdateTargetsModal');
        if (!modal) return;
        const searchEl = document.getElementById('saUpdateTargetsSearch');
        if (searchEl) searchEl.value = '';
        this.renderUpdateTargetsOptions();
        this._updateTargetModalCount('saUpdateTargetsModalCount', this._updateTargetUserIds);
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        setTimeout(() => {
            const searchElNow = document.getElementById('saUpdateTargetsSearch');
            if (searchElNow && typeof searchElNow.focus === 'function') {
                try { searchElNow.focus(); } catch (_) {}
            }
        }, 10);
    }

    closeUpdateTargetsModal() {
        const modal = document.getElementById('saUpdateTargetsModal');
        if (!modal) return;
        const activeEl = document.activeElement;
        if (activeEl && modal.contains(activeEl) && typeof activeEl.blur === 'function') {
            try { activeEl.blur(); } catch (_) {}
        }
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        const opener = document.getElementById('saUpdatePickTargetsBtn');
        if (opener && typeof opener.focus === 'function') {
            try { opener.focus(); } catch (_) {}
        }
    }

    renderUpdateTargetsOptions() {
        const root = document.getElementById('saUpdateTargetsOptions');
        if (!root) return;
        const filtered = this._filterUsersForTargetPicker('saUpdateTargetsSearch');
        if (!filtered.length) {
            root.innerHTML = '<p class="sa-minimal-count">No users found.</p>';
            this._updateTargetModalCount('saUpdateTargetsModalCount', this._updateTargetUserIds);
            return;
        }
        root.innerHTML = filtered.map((u) => {
            const uid = String(u.id || u.uid || '').trim();
            const checked = this._updateTargetUserIds.has(uid) ? 'checked' : '';
            return this._buildTargetOptionHtml(u, uid, checked, 'data-update-target-uid');
        }).join('');
        this._bindTargetOptionCheckboxes(root, 'data-update-target-uid', this._updateTargetUserIds, () => {
            this._updateTargetModalCount('saUpdateTargetsModalCount', this._updateTargetUserIds);
        });
        this._updateTargetModalCount('saUpdateTargetsModalCount', this._updateTargetUserIds);
    }

    _selectVisibleUpdateTargets() {
        const filtered = this._filterUsersForTargetPicker('saUpdateTargetsSearch');
        filtered.forEach((u) => {
            const uid = String(u.id || u.uid || '').trim();
            if (uid) this._updateTargetUserIds.add(uid);
        });
        this.renderUpdateTargetsOptions();
    }

    _clearAllUpdateTargets() {
        this._updateTargetUserIds.clear();
        this.renderUpdateTargetsOptions();
        this._updateUpdateTargetsCount();
    }

    applyUpdateTargetsFromModal() {
        this._updateUpdateTargetsCount();
        this.closeUpdateTargetsModal();
    }

    _updateUpdateTargetsCount() {
        const countEl = document.getElementById('saUpdateTargetsCount');
        if (!countEl) return;
        countEl.textContent = `${this._updateTargetUserIds.size} selected`;
        this._refreshReleaseFormValidation();
    }

    _destroyObservabilityCharts() {
        try {
            Object.keys(this._obsCharts || {}).forEach((k) => {
                const c = this._obsCharts[k];
                if (c && typeof c.destroy === 'function') c.destroy();
            });
        } catch (_) {}
        this._obsCharts = {};
    }

    _renderObservabilityStats(metrics) {
        const root = document.getElementById('saObservabilityStats');
        if (!root) return;
        if (!metrics || !metrics.performance || !metrics.usage || !metrics.errors || !metrics.load) {
            root.innerHTML = '<span class="sa-minimal-count">Observability data unavailable.</span>';
            return;
        }
        const perf = metrics.performance || {};
        const usage = metrics.usage || {};
        const errors = metrics.errors || {};
        const load = metrics.load || {};
        const alertSummary = metrics.alertSummary || {};
        const rangeHours = Math.max(1, Number(metrics.rangeHours || this._obsHours || 1));
        root.innerHTML = `
            <span class="sa-minimal-count">RPS: <strong>${Number(perf.requestsPerSecond || 0).toFixed(3)}</strong></span>
            <span class="sa-minimal-count">Avg Response: <strong>${Number(perf.averageResponseTimeMs || 0).toFixed(1)} ms</strong></span>
            <span class="sa-minimal-count">P95 Latency: <strong>${Number(perf.apiLatencyP95Ms || 0).toFixed(1)} ms</strong></span>
            <span class="sa-minimal-count">Active Users: <strong>${Number(usage.activeUsers || 0)}</strong></span>
            <span class="sa-minimal-count">Current Errors (5m): <strong>${Number(alertSummary.recentErrors || 0)}</strong></span>
            <span class="sa-minimal-count">Historical Errors (${rangeHours}h): <strong>${Number(errors.totalErrorsWindow || errors.totalErrors || 0)}</strong></span>
            <span class="sa-minimal-count">Concurrent (approx): <strong>${Number(load.concurrentUsersApprox || 0)}</strong></span>
        `;
    }

    _renderObservabilityCharts(metrics) {
        if (typeof Chart === 'undefined') return;
        this._destroyObservabilityCharts();
        const timeseries = Array.isArray(metrics && metrics.timeseries) ? metrics.timeseries : [];
        const labels = timeseries.map((x) => {
            const d = new Date(Number(x.ts || 0));
            return `${String(d.getHours()).padStart(2, '0')}:00`;
        });
        const requestsData = timeseries.map((x) => Number(x.requests || 0));
        const errorsData = timeseries.map((x) => Number(x.errors || 0));
        const actionsData = timeseries.map((x) => Number(x.actions || 0));
        const topFeatures = (metrics && metrics.usage && Array.isArray(metrics.usage.topFeatures))
            ? metrics.usage.topFeatures.slice(0, 6)
            : [];
        const fLabels = topFeatures.map((x) => String(x.key || 'feature'));
        const fData = topFeatures.map((x) => Number(x.count || 0));

        const perfEl = document.getElementById('saPerfChart');
        const usageEl = document.getElementById('saUsageChart');
        const errorEl = document.getElementById('saErrorChart');
        const loadEl = document.getElementById('saLoadChart');
        if (!perfEl || !usageEl || !errorEl || !loadEl) return;

        this._obsCharts.perf = new Chart(perfEl, {
            type: 'line',
            data: { labels, datasets: [{ label: 'Requests', data: requestsData, borderColor: '#4f46e5', backgroundColor: 'rgba(79,70,229,0.15)', fill: true, tension: 0.25 }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
        this._obsCharts.usage = new Chart(usageEl, {
            type: 'bar',
            data: { labels: fLabels, datasets: [{ label: 'Top Features', data: fData, backgroundColor: '#0ea5e9' }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
        this._obsCharts.errors = new Chart(errorEl, {
            type: 'line',
            data: { labels, datasets: [{ label: 'Errors', data: errorsData, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.12)', fill: true, tension: 0.25 }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
        this._obsCharts.load = new Chart(loadEl, {
            type: 'line',
            data: { labels, datasets: [{ label: 'Actions', data: actionsData, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.12)', fill: true, tension: 0.25 }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    _renderObservabilityAlerts(metrics) {
        const root = document.getElementById('saObservabilityAlerts');
        if (!root) return;
        const alerts = Array.isArray(metrics && metrics.alerts) ? metrics.alerts : [];
        if (!alerts.length) {
            root.innerHTML = '<span class="sa-minimal-count">No active alerts.</span>';
            this._lastAlertSignature = '';
            return;
        }
        const severityClass = (s) => {
            const v = String(s || '').toLowerCase();
            if (v === 'critical') return 'sa-ob-alert--critical';
            if (v === 'high') return 'sa-ob-alert--high';
            return 'sa-ob-alert--medium';
        };
        root.innerHTML = alerts.slice(0, 6).map((a) => {
            const sev = String(a.severity || 'medium');
            const title = this._escapeHtml(a.title || 'Alert');
            const msg = this._escapeHtml(a.message || '');
            return `<div class="sa-ob-alert ${severityClass(sev)}"><strong>${this._escapeHtml(sev.toUpperCase())}</strong> - ${title}: ${msg}</div>`;
        }).join('');

        const newSig = alerts.map((a) => `${a.type}:${a.severity}:${a.value || ''}`).join('|');
        if (newSig && newSig !== this._lastAlertSignature) {
            const hasCritical = alerts.some((a) => String(a.severity || '').toLowerCase() === 'critical');
            if (typeof showMessage === 'function') {
                showMessage(
                    hasCritical ? `Critical system alerts detected (${alerts.length}).` : `System alerts detected (${alerts.length}).`,
                    hasCritical ? 'error' : 'warning'
                );
            }
        }
        this._lastAlertSignature = newSig;
    }

    async loadObservabilityDashboard(force = false) {
        if (!(await this._guardAccess())) return;
        const panel = document.getElementById('saObservabilityPanel');
        if (!panel) return;
        if (typeof isFeatureEnabled === 'function' && !isFeatureEnabled('system_analytics_dashboard', true)) {
            panel.style.display = 'none';
            return;
        }
        panel.style.display = '';
        try {
            const metrics = await this.db.getSystemObservabilityMetricsSecure({ hours: this._obsHours || 1, force: !!force });
            this._renderObservabilityStats(metrics || {});
            this._renderObservabilityAlerts(metrics || {});
            this._renderObservabilityCharts(metrics || {});
            if (!this._obsRefreshTimer) {
                this._obsRefreshTimer = setInterval(() => {
                    const page = document.getElementById('superAdmin');
                    if (!page || !page.classList.contains('active')) return;
                    this.loadObservabilityDashboard(false);
                }, 60000);
            }
        } catch (error) {
            const root = document.getElementById('saObservabilityStats');
            if (root) root.innerHTML = '<span class="sa-minimal-count">Failed to load analytics metrics.</span>';
            const alertsRoot = document.getElementById('saObservabilityAlerts');
            if (alertsRoot) alertsRoot.innerHTML = '<span class="sa-minimal-count">Failed to load alerts.</span>';
            console.warn('loadObservabilityDashboard failed:', error);
        }
    }

    async clearOldObservabilityErrors() {
        if (!(await this._guardAccess())) return;
        if (!this.db || typeof this.db.clearSystemErrorLogsSecure !== 'function') return;
        const hours = Math.max(1, Number(this._obsHours || 1));
        const ok = typeof window.confirm === 'function'
            ? window.confirm(`Clear system error logs older than ${hours} hour(s)?`)
            : true;
        if (!ok) return;
        try {
            const res = await this.db.clearSystemErrorLogsSecure({ olderThanHours: hours, limit: 1200 });
            const deleted = Number(res && res.deleted || 0);
            if (typeof showMessage === 'function') showMessage(`Cleared ${deleted} old error logs.`, 'success');
            await this.loadObservabilityDashboard(true);
        } catch (error) {
            console.error('clearOldObservabilityErrors failed:', error);
            if (typeof showMessage === 'function') showMessage('Failed to clear old error logs.', 'error');
        }
    }

    _usageStatForUser(user) {
        const uid = String(user && (user.id || user.uid) || '');
        const live = (uid && this.usageStatsByUid && this.usageStatsByUid[uid]) ? this.usageStatsByUid[uid] : null;
        if (live && (Number(live.bytes || 0) > 0 || Number(live.megaBytes || 0) > 0)) return live;

        // Fallbacks from admin list payload when live usage docs are stale/missing.
        const fallbackBytes = Number(
            (user && (user.dbUsageBytes ?? user.usageBytes ?? user.storageBytes ?? user.totalBytes)) || 0
        );
        const fallbackMb = Number(
            (user && (user.dbUsageMB ?? user.usageMB ?? user.megaBytes)) || 0
        );
        if (Number.isFinite(fallbackBytes) && fallbackBytes > 0) {
            return { bytes: fallbackBytes, megaBytes: fallbackBytes / (1024 * 1024) };
        }
        if (Number.isFinite(fallbackMb) && fallbackMb > 0) {
            return { bytes: fallbackMb * 1024 * 1024, megaBytes: fallbackMb };
        }
        return live || {};
    }

    async markPendingCurrentBuild() {
        if (!(await this._guardAccess())) return;
        const versionCode = Number(window.__APP_VERSION_CODE || 0) || 0;
        if (!versionCode) {
            if (typeof showMessage === 'function') showMessage('Current build version is missing.', 'error');
            return;
        }
        try {
            const draft = this._collectReleaseDraftFromUi();
            if (this.db && typeof this.db.adminPrepareAppUpdateSecure === 'function') {
                await this.db.adminPrepareAppUpdateSecure({
                    versionCode,
                    versionLabel: draft.versionLabel,
                    changelog: draft.changelog,
                    rollout: draft.rollout,
                    masterAccountUids: [String((this.auth && this.auth.currentUser && this.auth.currentUser.uid) || '').trim()].filter(Boolean),
                    backupRequired: true,
                    backupId: draft.backupId,
                    backupStorageHint: draft.backupStorageHint
                });
            } else {
                await this.db.setPendingAppUpdate({ versionCode, versionLabel: draft.versionLabel });
            }
            if (typeof showMessage === 'function') showMessage(`Pending update set to ${draft.versionLabel}.`, 'success');
        } catch (error) {
            console.error('markPendingCurrentBuild failed:', error);
            if (typeof showMessage === 'function') showMessage('Failed to set pending update.', 'error');
        }
    }

    _getBuildPayloadForRelease(versionLabelOverride) {
        const approved = this._getLatestApprovedBuildMeta();
        const meta = (window.__APP_BUILD_META && typeof window.__APP_BUILD_META === 'object')
            ? window.__APP_BUILD_META
            : {};
        const scriptVersion = Number((approved && approved.scriptVersion) || meta.scriptVersion || window.__APP_VERSION_CODE || 0) || 0;
        return {
            buildId: String((approved && approved.buildId) || scriptVersion || ''),
            appVersion: String(versionLabelOverride || (approved && approved.appVersion) || meta.appVersion || window.__APP_VERSION_LABEL || ''),
            scriptVersion,
            cssVersion: Number((approved && approved.cssVersion) || meta.cssVersion || 0) || 0,
            deployedAt: String((approved && approved.deployedAt) || meta.deployedAt || new Date().toISOString()),
            env: 'prod'
        };
    }

    async releasePendingUpdate() {
        if (!(await this._guardAccess())) return;
        if (this._releaseInFlight) return;

        const releaseBtn = document.getElementById('saReleaseUpdateBtn');
        const draft = this._collectReleaseDraftFromUi();
        const validation = this._validateReleaseDraft(draft);
        if (!validation.ok) {
            if (typeof showMessage === 'function') showMessage(validation.message, 'error');
            this._refreshReleaseFormValidation();
            return;
        }

            const versionCode = Number(window.__APP_VERSION_CODE || 0) || 0;
            if (!versionCode) {
                if (typeof showMessage === 'function') showMessage('Current build version is missing.', 'error');
                return;
            }

        const versionLabel = validation.versionLabel || draft.versionLabel;
        this._releaseInFlight = true;
        const originalBtnHtml = releaseBtn ? releaseBtn.innerHTML : '';
        if (releaseBtn) {
            releaseBtn.disabled = true;
            releaseBtn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Releasing...';
        }

        try {
            let result = null;
            const payload = {
                    versionCode,
                versionLabel,
                target: draft.target,
                userIds: draft.userIds,
                    changelog: draft.changelog,
                    rollout: draft.rollout,
                build: this._getBuildPayloadForRelease(versionLabel),
                    backup: {
                        required: true,
                        backupId: draft.backupId,
                        storageHint: draft.backupStorageHint
                    }
            };
            if (this.db && typeof this.db.adminReleaseAppUpdateSecure === 'function') {
                result = await this.db.adminReleaseAppUpdateSecure(payload);
            } else {
                await this.db.releasePendingAppUpdate({ versionCode, versionLabel });
            }

            const selectedCount = Number(result && result.selectedUserCount)
                || (draft.target === 'selected_users' ? draft.userIds.length : 0);
            let successMsg;
            if (draft.target === 'selected_users' && selectedCount > 0) {
                successMsg = `Version ${versionLabel} released to ${selectedCount} selected user${selectedCount === 1 ? '' : 's'}.`;
            } else {
                successMsg = `Version ${versionLabel} released to all users.`;
            }
            if (typeof showMessage === 'function') showMessage(successMsg, 'success');
            await this.loadSimpleUpdateStats();
        } catch (error) {
            console.error('releasePendingUpdate failed:', error);
            if (typeof showMessage === 'function') showMessage(this._mapReleaseUpdateError(error), 'error');
        } finally {
            this._releaseInFlight = false;
            if (releaseBtn) releaseBtn.innerHTML = originalBtnHtml;
            this._refreshReleaseFormValidation();
        }
    }

    async createDemoAccountFromUi() {
        if (!(await this._guardAccess())) return;
        if (!this.db || typeof this.db.adminCreateDemoAccountSecure !== 'function') {
            if (typeof showMessage === 'function') showMessage('Demo account API is unavailable.', 'error');
            return;
        }
        const email = window.prompt('Demo account email:');
        if (!email || !String(email).trim()) return;
        const trialDays = 14;
        try {
            const payload = {
                email: String(email).trim(),
                trialDays,
                fullName: 'Demo Account'
            };
            const res = await this.db.adminCreateDemoAccountSecure(payload);
            const tempPassword = res && res.password ? String(res.password) : '(hidden)';
            if (typeof showMessage === 'function') {
                const reused = !!(res && res.reused);
                showMessage(
                    reused
                        ? `Demo account re-activated: ${payload.email} (14d). Password: ${tempPassword}`
                        : `Demo account created: ${payload.email} (14d). Password: ${tempPassword}`,
                    'success'
                );
            }
            await this.loadUsers();
        } catch (error) {
            console.error('createDemoAccountFromUi failed:', error);
            const rawMsg = String((error && (error.message || error.code)) || 'Failed to create demo account.');
            const lowMsg = rawMsg.toLowerCase();
            const msg = lowMsg.includes('non-demo account') || lowMsg.includes('email already exists')
                ? 'هذا الإيميل مستخدم بحساب عادي. استخدم إيميل ثاني للديمو.'
                : rawMsg;
            if (typeof showMessage === 'function') showMessage(msg, 'error');
        }
    }

    _handleUserTableClick(event) {
        const btn = event.target.closest('button[data-action][data-uid]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        const uid = btn.getAttribute('data-uid');
        if (!action || !uid) return;

        if (action === 'activate') this.activateSubscription(uid);
        else if (action === 'deactivate') this.deactivateSubscription(uid);
        else if (action === 'addDays') this.openAddDaysModal(uid);
        else if (action === 'lifetime') this.setLifetime(uid);
        else if (action === 'deleteAccount') this.deleteAccountPermanently(uid);
    }

    async activateSubscription(uid) {
        if (!(await this._guardAccess())) return;
        try {
            const start = new Date();
            const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
            await this.db.adminSetSubscriptionSecure({
                targetUid: uid,
                action: 'activate',
                startDate: start.toISOString(),
                endDate: end.toISOString(),
                requestId: `sa_activate_${Date.now()}`
            });
            if (typeof showMessage === 'function') showMessage('Subscription activated.', 'success');
            await this.loadUsers();
        } catch (error) {
            console.error('activateSubscription failed:', error);
            if (typeof showMessage === 'function') showMessage('Failed to activate subscription.', 'error');
        }
    }

    async deactivateSubscription(uid) {
        if (!(await this._guardAccess())) return;
        try {
            await this.db.adminSetSubscriptionSecure({
                targetUid: uid,
                action: 'deactivate',
                requestId: `sa_deactivate_${Date.now()}`
            });
            if (typeof showMessage === 'function') showMessage('Subscription deactivated.', 'success');
            await this.loadUsers();
        } catch (error) {
            console.error('deactivateSubscription failed:', error);
            if (typeof showMessage === 'function') showMessage('Failed to deactivate subscription.', 'error');
        }
    }

    async extendSubscription(uid, days) {
        if (!(await this._guardAccess())) return;
        const validDays = Number(days || 0);
        if (!Number.isFinite(validDays) || validDays <= 0) {
            if (typeof showMessage === 'function') showMessage('Invalid number of days.', 'error');
            return;
        }
        try {
            await this.db.adminSetSubscriptionSecure({
                targetUid: uid,
                action: 'extend',
                extendDays: validDays,
                requestId: `sa_extend_${validDays}_${Date.now()}`
            });
            if (typeof showMessage === 'function') showMessage(`Added ${validDays} days.`, 'success');
            await this.loadUsers();
        } catch (error) {
            console.error('extendSubscription failed:', error);
            if (typeof showMessage === 'function') showMessage('Failed to add days.', 'error');
        }
    }

    async setLifetime(uid) {
        if (!(await this._guardAccess())) return;
        try {
            await this.db.adminSetSubscriptionSecure({
                targetUid: uid,
                action: 'lifetime',
                requestId: `sa_lifetime_${Date.now()}`
            });
            if (typeof showMessage === 'function') showMessage('Lifetime subscription set.', 'success');
            await this.loadUsers();
        } catch (error) {
            console.error('setLifetime failed:', error);
            if (typeof showMessage === 'function') showMessage('Failed to set lifetime subscription.', 'error');
        }
    }

    async deleteAccountPermanently(uid) {
        if (!(await this._guardAccess())) return;
        const targetUid = String(uid || '').trim();
        if (!targetUid) {
            if (typeof showMessage === 'function') showMessage('Invalid user id.', 'error');
            return;
        }
        const user = this.allUsers.find((u) => String(u.id || u.uid || '') === targetUid) || null;
        const nameOrEmail = user
            ? String(user.fullName || user.name || user.email || targetUid)
            : targetUid;
        const confirmed = window.confirm(
            `Delete account permanently?\n\nUser: ${nameOrEmail}\nUID: ${targetUid}\n\nThis will delete Auth and account data from the system. This cannot be undone.`
        );
        if (!confirmed) return;
        try {
            await this.db.adminDeleteUserAccountSecure(targetUid);
            if (typeof showMessage === 'function') showMessage('Account deleted permanently.', 'success');
            await this.loadUsers();
        } catch (error) {
            console.error('deleteAccountPermanently failed:', error);
            const msg = String((error && (error.message || error.code)) || 'Failed to delete account.');
            if (typeof showMessage === 'function') showMessage(msg, 'error');
        }
    }

    openAddDaysModal(uid) {
        this.pendingAddDaysUid = uid;
        const modal = document.getElementById('superAdminAddDaysModal');
        const input = document.getElementById('saAddDaysInput');
        if (!modal || !input) return;
        input.value = '';
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        setTimeout(() => {
            try {
                input.focus();
            } catch (_) {}
        }, 50);
    }

    closeAddDaysModal() {
        const modal = document.getElementById('superAdminAddDaysModal');
        if (modal) {
            modal.classList.remove('active');
            modal.setAttribute('aria-hidden', 'true');
        }
        this.pendingAddDaysUid = null;
    }

    async saveAddDays() {
        if (!(await this._guardAccess())) return;
        if (!this.pendingAddDaysUid) return;
        const input = document.getElementById('saAddDaysInput');
        if (!input) return;
        const raw = String(input.value || '').trim();
        const n = parseInt(raw, 10);
        if (!Number.isFinite(n) || n < 1) {
            if (typeof showMessage === 'function') showMessage('Enter a valid number of days (1 or more).', 'error');
            return;
        }
        const uid = this.pendingAddDaysUid;
        this.closeAddDaysModal();
        await this.extendSubscription(uid, n);
    }

    loadSystemErrors() {
        return;
    }
}

let superAdminDashboard = null;

if (typeof window !== 'undefined') {
    const initSuperAdmin = () => {
        if (window.firebaseDbInstance && window.firebaseAuthInstance) {
            superAdminDashboard = new SuperAdminDashboard();
            window.superAdminDashboard = superAdminDashboard;
        } else {
            setTimeout(initSuperAdmin, 400);
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSuperAdmin);
    } else {
        initSuperAdmin();
    }
}

function showSuperAdminLink() {
    if (superAdminDashboard) superAdminDashboard.showSuperAdminLink();
    else if (window.superAdminDashboard) window.superAdminDashboard.showSuperAdminLink();
}

function hideSuperAdminLink() {
    if (superAdminDashboard) superAdminDashboard.hideSuperAdminLink();
    else if (window.superAdminDashboard) window.superAdminDashboard.hideSuperAdminLink();
}
