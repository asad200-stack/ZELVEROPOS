# Zelvero AI knowledge index — review of pending changes

Generated 2026-11-11T20:05:15.806Z from the local working tree. Nothing has been approved or published.

| | count |
|---|---|
| items in reviewed draft (disk) | 233 |
| items the current source produces | 247 |
| unchanged | 64 |
| source location only (same text) | 147 |
| content changed | 1 |
| added | 35 |
| removed | 21 |

## Content changed (1) — needs a human read

### test:src/offline/offline.test.ts#258
Fields: title, body, keywords

**Before:** The local test file src/offline/offline.test.ts contains a case titled "a waiting earlier sale blocks later ones (keeps stock priority)". This records the test name only, not a production result. Zelvero AI cannot run the test. This is from the local working tree, not a production deployment check.

**After:** The local test file src/offline/offline.test.ts contains a case titled "a paused earlier sale does not hold later sales". This records the test name only, not a production result. Zelvero AI cannot run the test. This is from the local working tree, not a production deployment check.

## Added (35)

- **callable:aiCopilotAccess** (callable): aiCopilotAccess is a Cloud Function named in the local source and in the POS client wrapper. The role check stays inside that function. This card does not guess it. Zelvero AI cannot call this functio
- **callable:aiCopilotRead** (callable): aiCopilotRead is a Cloud Function named in the local source and in the POS client wrapper. The role check stays inside that function. This card does not guess it. Zelvero AI cannot call this function.
- **callable:grantFeaturePurchase** (callable): grantFeaturePurchase is a Cloud Function named in the local source and in the POS client wrapper. The role check stays inside that function. This card does not guess it. Zelvero AI cannot call this fu
- **callable:issuePreviewCredential** (callable): issuePreviewCredential is a Cloud Function named in the local source and in the POS client wrapper. The role check stays inside that function. This card does not guess it. Zelvero AI cannot call this 
- **callable:listFeatureCatalog** (callable): listFeatureCatalog is a Cloud Function named in the local source and in the POS client wrapper. The role check stays inside that function. This card does not guess it. Zelvero AI cannot call this func
- **callable:listMyFeatureUpdates** (callable): listMyFeatureUpdates is a Cloud Function named in the local source and in the POS client wrapper. The role check stays inside that function. This card does not guess it. Zelvero AI cannot call this fu
- **callable:markFeatureReady** (callable): markFeatureReady is a Cloud Function named in the local source and in the POS client wrapper. The role check stays inside that function. This card does not guess it. Zelvero AI cannot call this functi
- **callable:pauseFeature** (callable): pauseFeature is a Cloud Function named in the local source and in the POS client wrapper. The role check stays inside that function. This card does not guess it. Zelvero AI cannot call this function. 
- **callable:previewPos** (callable): previewPos is a Cloud Function named in the local source and in the POS client wrapper. The role check stays inside that function. This card does not guess it. Zelvero AI cannot call this function. Th
- **callable:publishFeature** (callable): publishFeature is a Cloud Function named in the local source and in the POS client wrapper. The role check stays inside that function. This card does not guess it. Zelvero AI cannot call this function
- **callable:recordFeaturePreview** (callable): recordFeaturePreview is a Cloud Function named in the local source and in the POS client wrapper. The role check stays inside that function. This card does not guess it. Zelvero AI cannot call this fu
- **callable:rollbackFeature** (callable): rollbackFeature is a Cloud Function named in the local source and in the POS client wrapper. The role check stays inside that function. This card does not guess it. Zelvero AI cannot call this functio
- **callable:setFeatureKillSwitch** (callable): setFeatureKillSwitch is a Cloud Function named in the local source and in the POS client wrapper. The role check stays inside that function. This card does not guess it. Zelvero AI cannot call this fu
- **test:src/offline/offline.test.ts#274** (test): The local test file src/offline/offline.test.ts contains a case titled "a waiting earlier sale blocks later ones (keeps stock priority)". This records the test name only, not a production result. Zelv
- **test:src/offline/offline.test.ts#287** (test): The local test file src/offline/offline.test.ts contains a case titled "business failures become CONFLICT / REJECTED, are never retried automatically, and do not block later sales". This records the t
- **test:src/offline/offline.test.ts#309** (test): The local test file src/offline/offline.test.ts contains a case titled "only sends the signed-in user’s own operations". This records the test name only, not a production result. Zelvero AI cannot run
- **test:src/offline/offline.test.ts#319** (test): The local test file src/offline/offline.test.ts contains a case titled "prunes old SYNCED records but never failed ones". This records the test name only, not a production result. Zelvero AI cannot ru
- **test:src/offline/offline.test.ts#333** (test): The local test file src/offline/offline.test.ts contains a case titled "while tab A is syncing, tab B sees the queue but does not submit the same operation". This records the test name only, not a pro
- **test:src/offline/offline.test.ts#354** (test): The local test file src/offline/offline.test.ts contains a case titled "two tabs starting at the same instant: exactly one submits". This records the test name only, not a production result. Zelvero A
- **test:src/offline/offline.test.ts#362** (test): The local test file src/offline/offline.test.ts contains a case titled "the atomic claim alone prevents double-processing even if both tabs got past the lease". This records the test name only, not a 
- **test:src/offline/offline.test.ts#372** (test): The local test file src/offline/offline.test.ts contains a case titled "a crashed tab’s lease expires and the stuck SYNCING sale is recovered and resent with the same id". This records the test name o
- **test:src/offline/offline.test.ts#393** (test): The local test file src/offline/offline.test.ts contains a case titled "lease: free/expired/own → granted, held by another → refused". This records the test name only, not a production result. Zelvero
- **test:src/offline/offline.test.ts#413** (test): The local test file src/offline/offline.test.ts contains a case titled "an offline cash sale that later conflicts stays visible as ACTION REQUIRED with its cash". This records the test name only, not 
- **test:src/offline/offline.test.ts#421** (test): The local test file src/offline/offline.test.ts contains a case titled "dismissing keeps the record (audit) and clears ACTION REQUIRED; a handled record cannot be retried". This records the test name 
- **test:src/offline/offline.test.ts#433** (test): The local test file src/offline/offline.test.ts contains a case titled "manual Retry after the cause is fixed sends the same sale again". This records the test name only, not a production result. Zelv
- **test:src/offline/offline.test.ts#450** (test): The local test file src/offline/offline.test.ts contains a case titled "a user sees only their own operations; colleagues are a count; other stores are invisible". This records the test name only, not
- **test:src/offline/offline.test.ts#459** (test): The local test file src/offline/offline.test.ts contains a case titled "signing in as someone else neither shows nor deletes the previous user's pending sales". This records the test name only, not a 
- **test:src/offline/offline.test.ts#471** (test): The local test file src/offline/offline.test.ts contains a case titled "keeps 150 queued sales for a several-hour simulated shift, then syncs each id once". This records the test name only, not a prod
- **test:src/offline/offline.test.ts#495** (test): The local test file src/offline/offline.test.ts contains a case titled "measures reconnect of 10 / 50 / 100 queued operations without double replay". This records the test name only, not a production 
- **test:src/offline/offline.test.ts#512** (test): The local test file src/offline/offline.test.ts contains a case titled "a conflict in the middle of the queue does not drop later valid sales". This records the test name only, not a production result
- **test:src/offline/offline.test.ts#537** (test): The local test file src/offline/offline.test.ts contains a case titled "reconnect that drops mid-sync, then reconnects again, still commits each sale once". This records the test name only, not a prod
- **test:src/offline/offline.test.ts#551** (test): The local test file src/offline/offline.test.ts contains a case titled "operations several days old are not auto-deleted and still conflict correctly". This records the test name only, not a productio
- **test:src/offline/offline.test.ts#564** (test): The local test file src/offline/offline.test.ts contains a case titled "a stored cash sale reaches the server with no null placeholders for absent fields". This records the test name only, not a produ
- **test:src/offline/offline.test.ts#572** (test): The local test file src/offline/offline.test.ts contains a case titled "keeps meaningful nulls and nested values". This records the test name only, not a production result. Zelvero AI cannot run the t
- **test:src/offline/offline.test.ts#603** (test): The local test file src/offline/offline.test.ts contains a case titled "online checkout falls back to the queue ONLY for transport failures". This records the test name only, not a production result. 

## Removed (21)

- test:src/offline/offline.test.ts#271
- test:src/offline/offline.test.ts#293
- test:src/offline/offline.test.ts#303
- test:src/offline/offline.test.ts#317
- test:src/offline/offline.test.ts#338
- test:src/offline/offline.test.ts#346
- test:src/offline/offline.test.ts#356
- test:src/offline/offline.test.ts#377
- test:src/offline/offline.test.ts#397
- test:src/offline/offline.test.ts#405
- test:src/offline/offline.test.ts#417
- test:src/offline/offline.test.ts#434
- test:src/offline/offline.test.ts#443
- test:src/offline/offline.test.ts#455
- test:src/offline/offline.test.ts#479
- test:src/offline/offline.test.ts#496
- test:src/offline/offline.test.ts#521
- test:src/offline/offline.test.ts#535
- test:src/offline/offline.test.ts#548
- test:src/offline/offline.test.ts#556
- test:src/offline/offline.test.ts#587

## Source location only (147) — same title/body/keywords/route/permission; only file line numbers / hash moved

- callable:adminDeleteAccount: functions/src/index.ts:5-5 → functions/src/index.ts:5-5
- callable:adminListAccounts: functions/src/index.ts:5-5 → functions/src/index.ts:5-5
- callable:adminListLeads: functions/src/index.ts:12-12 → functions/src/index.ts:14-14
- callable:adminListStorageCleanup: functions/src/index.ts:5-5 → functions/src/index.ts:5-5
- callable:adminListTrials: functions/src/index.ts:14-14 → functions/src/index.ts:16-16
- callable:adminProvisionInternalDemo: functions/src/index.ts:6-6 → functions/src/index.ts:6-6
- callable:adminRetryStorageCleanup: functions/src/index.ts:5-5 → functions/src/index.ts:5-5
- callable:adminSetLeadStatus: functions/src/index.ts:13-13 → functions/src/index.ts:15-15
- callable:adminSetSubscription: functions/src/index.ts:5-5 → functions/src/index.ts:5-5
- callable:assignReleaseTenants: functions/src/index.ts:20-20 → functions/src/index.ts:22-22
- callable:bootstrapSuperAdmin: functions/src/index.ts:5-5 → functions/src/index.ts:5-5
- callable:checkReleaseTreeRetention: functions/src/index.ts:27-27 → functions/src/index.ts:29-29
- callable:checkSignupAvailability: functions/src/index.ts:3-3 → functions/src/index.ts:3-3
- callable:clearTenantData: functions/src/index.ts:29-29 → functions/src/index.ts:31-31
- callable:completeSignup: functions/src/index.ts:3-3 → functions/src/index.ts:3-3
- callable:createRelease: functions/src/index.ts:18-18 → functions/src/index.ts:20-20
- callable:deleteSubUser: functions/src/index.ts:4-4 → functions/src/index.ts:4-4
- callable:getMyReleaseAssignment: functions/src/index.ts:25-25 → functions/src/index.ts:27-27
- callable:listReleases: functions/src/index.ts:26-26 → functions/src/index.ts:28-28
- callable:pauseRelease: functions/src/index.ts:22-22 → functions/src/index.ts:24-24
- callable:posAdjustDebt: functions/src/pos/customers.ts:147-182 → functions/src/pos/customers.ts:147-182
- callable:posAdjustDrawer: functions/src/pos/cash.ts:73-104 → functions/src/pos/cash.ts:73-104
- callable:posAdjustStock: functions/src/pos/inventory.ts:247-328 → functions/src/pos/inventory.ts:258-339
- callable:posCashMove: functions/src/pos/cash.ts:30-34 → functions/src/pos/cash.ts:30-34
- callable:posCheckout: functions/src/pos/sales.ts:81-142 → functions/src/pos/sales.ts:82-142
- callable:posCreateCustomer: functions/src/pos/customers.ts:35-37 → functions/src/pos/customers.ts:35-37
- callable:posCreateProduct: functions/src/pos/inventory.ts:43-45 → functions/src/pos/inventory.ts:49-70
- callable:posCreatePurchase: functions/src/pos/suppliers.ts:42-162 → functions/src/pos/suppliers.ts:42-162
- callable:posDeleteProduct: functions/src/pos/inventory.ts:204-206 → functions/src/pos/inventory.ts:215-217
- callable:posImportProducts: functions/src/pos/inventory.ts:126-128 → functions/src/pos/inventory.ts:137-139
- callable:posPayDebt: functions/src/pos/customers.ts:83-85 → functions/src/pos/customers.ts:83-85
- callable:posPaySupplier: functions/src/pos/suppliers.ts:181-262 → functions/src/pos/suppliers.ts:181-262
- callable:posReturn: functions/src/pos/sales.ts:402-547 → functions/src/pos/sales.ts:402-547
- callable:posReturnToSupplier: functions/src/pos/suppliers.ts:278-280 → functions/src/pos/suppliers.ts:278-280
- callable:posSetProductStatus: functions/src/pos/inventory.ts:178-180 → functions/src/pos/inventory.ts:189-191
- callable:refreshMyClaims: functions/src/index.ts:3-3 → functions/src/index.ts:3-3
- callable:releaseToEveryone: functions/src/index.ts:21-21 → functions/src/index.ts:23-23
- callable:rollbackRelease: functions/src/index.ts:23-23 → functions/src/index.ts:25-25
- callable:setMinSupportedVersion: functions/src/index.ts:24-24 → functions/src/index.ts:26-26
- callable:setReleaseStatus: functions/src/index.ts:19-19 → functions/src/index.ts:21-21
- callable:testTelegram: functions/src/index.ts:35-35 → functions/src/index.ts:49-49
- callable:updateSubUser: functions/src/index.ts:4-4 → functions/src/index.ts:4-4
- label:cash.actions: src/i18n/en.ts:654-654 → src/i18n/en.ts:679-679
- label:cash.adjust: src/i18n/en.ts:637-637 → src/i18n/en.ts:662-662
- label:cash.deposit: src/i18n/en.ts:659-659 → src/i18n/en.ts:684-684
- label:cash.expense: src/i18n/en.ts:661-661 → src/i18n/en.ts:686-686
- label:cash.withdrawal: src/i18n/en.ts:670-670 → src/i18n/en.ts:695-695
- label:customers.adjustDebt: src/i18n/en.ts:553-553 → src/i18n/en.ts:578-578
- label:customers.debt: src/i18n/en.ts:559-559 → src/i18n/en.ts:584-584
- label:customers.pay: src/i18n/en.ts:572-572 → src/i18n/en.ts:597-597
- label:nav.cashbox: src/i18n/en.ts:70-70 → src/i18n/en.ts:89-89
- label:nav.collapseMenu: src/i18n/en.ts:75-75 → src/i18n/en.ts:94-94
- label:nav.customers: src/i18n/en.ts:71-71 → src/i18n/en.ts:90-90
- label:nav.dashboard: src/i18n/en.ts:72-72 → src/i18n/en.ts:91-91
- label:nav.expandMenu: src/i18n/en.ts:76-76 → src/i18n/en.ts:95-95
- label:nav.expiry: src/i18n/en.ts:73-73 → src/i18n/en.ts:92-92
- label:nav.menu: src/i18n/en.ts:74-74 → src/i18n/en.ts:93-93
- label:nav.pos: src/i18n/en.ts:77-77 → src/i18n/en.ts:96-96
- label:nav.products: src/i18n/en.ts:78-78 → src/i18n/en.ts:97-97
- label:nav.purchases: src/i18n/en.ts:79-79 → src/i18n/en.ts:98-98
- label:nav.reports: src/i18n/en.ts:80-80 → src/i18n/en.ts:99-99
- label:nav.sales: src/i18n/en.ts:81-81 → src/i18n/en.ts:100-100
- label:nav.settings: src/i18n/en.ts:82-82 → src/i18n/en.ts:101-101
- label:nav.suppliers: src/i18n/en.ts:83-83 → src/i18n/en.ts:102-102
- label:nav.users: src/i18n/en.ts:84-84 → src/i18n/en.ts:103-103
- label:offline.posBanner: src/i18n/en.ts:916-916 → src/i18n/en.ts:944-944
- label:offline.receiptNotInvoice: src/i18n/en.ts:908-908 → src/i18n/en.ts:936-936
- label:offline.savedNotInvoice: src/i18n/en.ts:913-913 → src/i18n/en.ts:941-941
- label:perm.canAddProducts: src/i18n/en.ts:781-781 → src/i18n/en.ts:808-808
- label:perm.canDeleteProducts: src/i18n/en.ts:783-783 → src/i18n/en.ts:810-810
- label:perm.canEditPrice: src/i18n/en.ts:778-778 → src/i18n/en.ts:805-805
- label:perm.canEditProducts: src/i18n/en.ts:782-782 → src/i18n/en.ts:809-809
- label:perm.canEditSettings: src/i18n/en.ts:791-791 → src/i18n/en.ts:818-818
- label:perm.canExportProducts: src/i18n/en.ts:785-785 → src/i18n/en.ts:812-812
- label:perm.canImportProducts: src/i18n/en.ts:784-784 → src/i18n/en.ts:811-811
- label:perm.canManageCashDrawer: src/i18n/en.ts:789-789 → src/i18n/en.ts:816-816
- label:perm.canSell: src/i18n/en.ts:777-777 → src/i18n/en.ts:804-804
- label:perm.canUseZelveroAI: src/i18n/en.ts:794-794 → src/i18n/en.ts:821-821
- label:perm.canViewCosts: src/i18n/en.ts:792-792 → src/i18n/en.ts:819-819
- label:perm.canViewCustomers: src/i18n/en.ts:786-786 → src/i18n/en.ts:813-813
- label:perm.canViewProducts: src/i18n/en.ts:780-780 → src/i18n/en.ts:807-807
- label:perm.canViewReports: src/i18n/en.ts:787-787 → src/i18n/en.ts:814-814
- label:perm.canViewSales: src/i18n/en.ts:779-779 → src/i18n/en.ts:806-806
- label:perm.canViewSensitiveData: src/i18n/en.ts:793-793 → src/i18n/en.ts:820-820
- label:perm.canViewSettings: src/i18n/en.ts:790-790 → src/i18n/en.ts:817-817
- label:perm.canViewSuppliers: src/i18n/en.ts:788-788 → src/i18n/en.ts:815-815
- label:pos.addPreviousBalance: src/i18n/en.ts:284-284 → src/i18n/en.ts:303-303
- label:pos.checkout: src/i18n/en.ts:313-313 → src/i18n/en.ts:332-332
- label:pos.clearCart: src/i18n/en.ts:337-337 → src/i18n/en.ts:356-356
- label:pos.paymentMethod: src/i18n/en.ts:364-364 → src/i18n/en.ts:383-383
- label:pos.payPrevious: src/i18n/en.ts:288-288 → src/i18n/en.ts:307-307
- label:pos.searchPlaceholder: src/i18n/en.ts:380-380 → src/i18n/en.ts:404-404
- label:products.adjustStock: src/i18n/en.ts:445-445 → src/i18n/en.ts:469-469
- label:products.archive: src/i18n/en.ts:459-459 → src/i18n/en.ts:484-484
- label:products.deleteConfirm: src/i18n/en.ts:457-457 → src/i18n/en.ts:482-482
- label:products.deleteForever: src/i18n/en.ts:465-465 → src/i18n/en.ts:490-490
- label:purchases.confirmReturn: src/i18n/en.ts:616-616 → src/i18n/en.ts:641-641
- label:purchases.new: src/i18n/en.ts:620-620 → src/i18n/en.ts:645-645
- label:purchases.payFromCashbox: src/i18n/en.ts:626-626 → src/i18n/en.ts:651-651
- label:purchases.returnToSupplier: src/i18n/en.ts:628-628 → src/i18n/en.ts:653-653
- label:reports.capital: src/i18n/en.ts:675-675 → src/i18n/en.ts:700-700
- label:reports.customers: src/i18n/en.ts:683-683 → src/i18n/en.ts:708-708
- label:reports.expenses: src/i18n/en.ts:686-686 → src/i18n/en.ts:711-711
- label:reports.inventory: src/i18n/en.ts:688-688 → src/i18n/en.ts:713-713
- label:reports.profit: src/i18n/en.ts:697-697 → src/i18n/en.ts:722-722
- label:reports.sales: src/i18n/en.ts:703-703 → src/i18n/en.ts:728-728
- label:returns.confirm: src/i18n/en.ts:429-429 → src/i18n/en.ts:453-453
- label:returns.confirmMessage: src/i18n/en.ts:430-430 → src/i18n/en.ts:454-454
- label:returns.start: src/i18n/en.ts:440-440 → src/i18n/en.ts:464-464
- permission:canAddProducts: src/constants/permissions.ts:14-14 → src/constants/permissions.ts:24-24
- permission:canDeleteProducts: src/constants/permissions.ts:16-16 → src/constants/permissions.ts:26-26
- permission:canEditPrice: src/constants/permissions.ts:11-11 → src/constants/permissions.ts:21-21
- permission:canEditProducts: src/constants/permissions.ts:15-15 → src/constants/permissions.ts:25-25
- permission:canEditSettings: src/constants/permissions.ts:24-24 → src/constants/permissions.ts:34-34
- permission:canExportProducts: src/constants/permissions.ts:18-18 → src/constants/permissions.ts:28-28
- permission:canImportProducts: src/constants/permissions.ts:17-17 → src/constants/permissions.ts:27-27
- permission:canManageCashDrawer: src/constants/permissions.ts:22-22 → src/constants/permissions.ts:32-32
- permission:canSell: src/constants/permissions.ts:10-10 → src/constants/permissions.ts:20-20
- permission:canUseZelveroAI: src/constants/permissions.ts:27-27 → src/constants/permissions.ts:37-37
- permission:canViewCosts: src/constants/permissions.ts:25-25 → src/constants/permissions.ts:35-35
- permission:canViewCustomers: src/constants/permissions.ts:19-19 → src/constants/permissions.ts:29-29
- permission:canViewProducts: src/constants/permissions.ts:13-13 → src/constants/permissions.ts:23-23
- permission:canViewReports: src/constants/permissions.ts:20-20 → src/constants/permissions.ts:30-30
- permission:canViewSales: src/constants/permissions.ts:12-12 → src/constants/permissions.ts:22-22
- permission:canViewSensitiveData: src/constants/permissions.ts:26-26 → src/constants/permissions.ts:36-36
- permission:canViewSettings: src/constants/permissions.ts:23-23 → src/constants/permissions.ts:33-33
- permission:canViewSuppliers: src/constants/permissions.ts:21-21 → src/constants/permissions.ts:31-31
- route:/admin: src/app/AppRoutes.tsx:68-68 → src/app/AppRoutes.tsx:97-97
- route:/auth/action: src/app/AppRoutes.tsx:62-62 → src/app/AppRoutes.tsx:91-91
- route:/cashbox: src/app/navigation.ts:17-17 → src/app/navigation.ts:17-17
- route:/customers: src/app/navigation.ts:21-21 → src/app/navigation.ts:21-21
- route:/dashboard: src/app/navigation.ts:15-15 → src/app/navigation.ts:15-15
- route:/expiry: src/app/navigation.ts:19-19 → src/app/navigation.ts:19-19
- route:/forgot-password: src/app/AppRoutes.tsx:59-59 → src/app/AppRoutes.tsx:88-88
- route:/login: src/app/AppRoutes.tsx:57-57 → src/app/AppRoutes.tsx:86-86
- route:/pos: src/app/navigation.ts:16-16 → src/app/navigation.ts:16-16
- route:/products: src/app/navigation.ts:18-18 → src/app/navigation.ts:18-18
- route:/purchases: src/app/navigation.ts:23-23 → src/app/navigation.ts:23-23
- route:/reports: src/app/navigation.ts:24-24 → src/app/navigation.ts:24-24
- route:/sales: src/app/navigation.ts:20-20 → src/app/navigation.ts:20-20
- route:/settings: src/app/navigation.ts:26-26 → src/app/navigation.ts:26-26
- route:/setup: src/app/AppRoutes.tsx:63-63 → src/app/AppRoutes.tsx:92-92
- route:/signup: src/app/AppRoutes.tsx:58-58 → src/app/AppRoutes.tsx:87-87
- route:/suppliers: src/app/navigation.ts:22-22 → src/app/navigation.ts:22-22
- route:/users: src/app/navigation.ts:25-25 → src/app/navigation.ts:25-25
- route:/verify-email: src/app/AppRoutes.tsx:61-61 → src/app/AppRoutes.tsx:90-90
- rule:permissions-server-side: src/constants/permissions.ts:3-4 → src/constants/permissions.ts:7-8
