/** Back-compat wrapper — prefer pageUiBridge for new call sites. */
export {
  clearPendingOpenCreateProductForm,
  registerProductsUiHost,
  requestOpenCreateProductForm,
  unregisterProductsUiHost,
  type PageUiHost as ProductsUiHost,
} from './pageUiBridge';
