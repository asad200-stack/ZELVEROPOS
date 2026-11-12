import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canProcessReturn, type PermissionKey } from '../../src/constants/permissions';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

function canFrom(granted: PermissionKey[]) {
  const set = new Set(granted);
  return (permission: PermissionKey) => set.has(permission);
}

describe('return authorization policy', () => {
  it('allows a seller with sales-view but no drawer management', () => {
    expect(canProcessReturn(canFrom(['canViewSales', 'canSell']))).toBe(true);
  });

  it('denies a sales-view-only reporter', () => {
    expect(canProcessReturn(canFrom(['canViewSales']))).toBe(false);
    expect(canProcessReturn(canFrom(['canViewSales', 'canViewReports']))).toBe(false);
  });

  it('allows a drawer manager with sales-view', () => {
    expect(canProcessReturn(canFrom(['canViewSales', 'canManageCashDrawer']))).toBe(true);
  });

  it('denies missing sales-view even when the user can sell or manage the drawer', () => {
    expect(canProcessReturn(canFrom(['canSell']))).toBe(false);
    expect(canProcessReturn(canFrom(['canManageCashDrawer']))).toBe(false);
    expect(canProcessReturn(canFrom(['canSell', 'canManageCashDrawer']))).toBe(false);
  });

  it('wires the same policy on the UI return action and posReturn server auth', () => {
    const modal = read('../../src/features/sales/SaleDetailsModal.tsx');
    expect(modal).toContain('canProcessReturn(can)');
    const sales = read('../../functions/src/pos/sales.ts');
    const body = sales.slice(sales.indexOf('export const posReturn'));
    expect(body).toContain("['canSell', 'canManageCashDrawer']");
    expect(body).toContain("requirePerm(actor, 'canViewSales')");
  });
});
