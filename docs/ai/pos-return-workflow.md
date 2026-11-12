# POS customer return workflow (local source)

Verified from `src/domain/returns.ts` (`planReturn`) and `functions/src/pos/sales.ts` (`posReturn`). Zelvero AI cannot run a return.

1. A return is planned against an existing sale line by line. Only remaining unreturned quantity may be returned.
2. Stock: for each returned product that still exists, quantity is added back and a stock movement of type `return` is recorded. IMEIs on the return are marked available again when present. If the product was deleted since the sale, that line is skipped for restock.
3. Cash sale: the returned value is refunded from the cash drawer, split into USD/LBP in the same proportion as the original payment (`splitRefund`). The drawer must already hold enough USD and LBP; otherwise the return is refused (`error.drawerInsufficient`).
4. Credit sale: unpaid debt from this sale is reduced first (up to the returned amount, the sale’s remaining unpaid portion, and the customer’s live debt). Any remainder of the returned amount is refunded in cash the same way as a cash sale. Debt reduction writes a customer ledger `refund` entry; it does not also pay that same portion out as cash.
5. Permissions: completing `posReturn` requires sell or cash-drawer management, plus viewing sales. Zelvero AI cannot call it.
