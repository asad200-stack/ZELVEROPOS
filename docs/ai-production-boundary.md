# Zelvero AI production boundary

This note describes the assistant that is already in the app. It does not add a hosted model, change Firebase, or change who can read a store.

The signed-in session chooses the store. The model cannot. Store answers are built by the app from the reads that role is already allowed to open. The model, when it is used, only rephrases that note. Accepted wording is a labeled side note. If the wording is rejected, missing, or the model does not answer, the store note stays on screen.

## When the local model is not running

The panel asks `http://127.0.0.1:8081` on the same computer as the browser. If that process is down, or the page is not allowed to call it, the probe fails. No other model is contacted. There is no paid API fallback.

What still works:

- Sales totals, the cash drawer, one product’s stock, low stock, out of stock, expiry, customer debts, product rankings, and low or zero stock joined with posted sales.
- Permission refusals, empty results, and incomplete pages. Those notes do not turn into invented totals or rankings.
- Reviewed documentation answers for how the screens work.

What does not appear: the side note labeled “Wording from the local model.” The store note is the whole answer.

## When the app and the model are on different computers

`127.0.0.1` and `localhost` mean the computer where the browser is open. A model running on another computer is not reached by that address. The app also rejects any model URL that is not loopback HTTP, or that adds a path, a query, or a password.

The store note still works on the other computer, because it is read through the signed-in app, not through the model. Model wording does not. Pointing the app at another machine’s address is refused by the URL check.

## What multiple customers would require

This phase does not build that service. A shared model for many stores would need, at least:

- A process that is not loopback, with its own authentication, so one store cannot send or receive another store’s note.
- A rule that the snapshot sent for rephrasing is the same note the user’s permissions already produced, and nothing else.
- No use of `127.0.0.1` as if it were a central server.

## Why 127.0.0.1 is not a shared server

`127.0.0.1` is the machine the browser is on. Every customer who opened a page aimed at `127.0.0.1` would be talking to their own computer, not to one shared model. If the app instead allowed a public or LAN address, store notes (sales, stock, debts, the drawer) would be sent to a process that does not know the Zelvero user or store. The loopback check exists so a remote address cannot be configured as the model.
