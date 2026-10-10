# Pre-launch: physical-device concurrency (not PASS)

Phase E used two Auth users and two IndexedDB factories in one environment. That is **not** two physical devices. Do not mark this PASS until the list below is run on real hardware.

## Devices

- [ ] Two real browser profiles or two machines, same store, same shift
- [ ] Two phones/tablets if available (Chrome/Safari), same store

## Scenarios (online + disconnect/reconnect)

- [ ] Same low-stock product sold from both devices at once
- [ ] Same customer credit sale + debt payment overlapping
- [ ] USD and LBP drawer moves overlapping
- [ ] Network disconnect on device A, sale queued, device B sells the last unit, A reconnects
- [ ] Lost-response retry of the same `saleId` / `clientOperationId` after reconnect
- [ ] Disable a cashier on device B while device A is mid-checkout / mid-sync

Record device model, browser, and whether stock, invoices, drawer, and debt stayed consistent.
