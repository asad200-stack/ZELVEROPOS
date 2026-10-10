import { useTenant } from '@/contexts/session';
import { useResource } from '@/stores/tenantStore';

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
