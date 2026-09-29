import { useMemo } from 'react';
import { useTenant } from '@/contexts/session';
import { useResource } from '@/stores/tenantStore';
import type { Customer, Product, Supplier } from '@/types/models';

export function useProducts() {
  const { tenantId } = useTenant();
  return useResource(tenantId, 'products');
}

export function useProductMap(): Map<string, Product> {
  const { data } = useProducts();
  return useMemo(() => new Map(data.map((p) => [p.id, p])), [data]);
}

export function useCustomers() {
  const { tenantId } = useTenant();
  return useResource(tenantId, 'customers');
}

export function useCustomerMap(): Map<string, Customer> {
  const { data } = useCustomers();
  return useMemo(() => new Map(data.map((c) => [c.id, c])), [data]);
}

export function useSuppliers() {
  const { tenantId } = useTenant();
  return useResource(tenantId, 'suppliers');
}

export function useSupplierMap(): Map<string, Supplier> {
  const { data } = useSuppliers();
  return useMemo(() => new Map(data.map((s) => [s.id, s])), [data]);
}

export function useSettings() {
  const { tenantId } = useTenant();
  return useResource(tenantId, 'settings').data;
}

export function useSettingsState() {
  const { tenantId } = useTenant();
  return useResource(tenantId, 'settings');
}

export function useCashbox() {
  const { tenantId } = useTenant();
  return useResource(tenantId, 'cashbox');
}

export function useCategories() {
  const { tenantId } = useTenant();
  return useResource(tenantId, 'categories').data;
}
