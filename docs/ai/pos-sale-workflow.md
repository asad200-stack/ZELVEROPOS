# POS sale workflow (local source)

Verified from the local POS code (`PosPage`, `ProductPicker`, `CartPanel`, `PaymentPanel`, `domain/cart`, `domain/checkout`). Zelvero AI cannot run any of these steps.

1. Open Point of sale (`/pos`). The cashier needs `canSell`.
2. Find products (search, category, or barcode) and add them to the cart. Quantity starts at one and can be increased; some tracked items use an IMEI line instead of a plain quantity bump.
3. Review the cart: change quantities, remove lines, or clear the cart. With `canEditPrice`, a line unit price may be changed; a lower unit price is shown as a line discount against the original tier price. There is no separate whole-cart coupon feature in this source.
4. Optionally choose a customer. Credit sale requires a customer.
5. Open checkout. Choose cash or credit.
6. Cash: enter amounts received in USD and/or LBP. The app plans change in USD and LBP separately and can warn if the drawer cannot cover change. Confirm to complete the sale.
7. Credit: enter what the customer pays now in USD and/or LBP; confirm the credit dialog; then complete. Credit checks the customer credit limit in source.
8. Completing the sale calls the POS checkout path (`checkout` / `posCheckout`). Stock, drawer, and customer balance change only when that path succeeds. Offline, a pending local sale may be saved until the server accepts it — that pending slip is not an official invoice yet.

Zelvero AI remains read-only: it does not add products, take payment, or call checkout.
