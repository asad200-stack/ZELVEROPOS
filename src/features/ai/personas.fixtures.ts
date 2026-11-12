/**
 * Isolated permission personas for AI / POS fixture tests.
 * No Auth, Firestore, or network — pure permission maps + can() helpers.
 */

import {
  ALL_PERMISSIONS,
  DEFAULT_SUBUSER_PERMISSIONS,
  normalizePermissions,
  type PermissionKey,
  type PermissionMap,
} from '@/constants/permissions';

export type PersonaId = 'owner' | 'staffAiSell' | 'staffNoAiSell' | 'staffAiNoSell';

export type PersonaFixture = {
  id: PersonaId;
  label: string;
  isOwner: boolean;
  perms: PermissionMap;
  can: (permission: PermissionKey) => boolean;
};

function fromMap(id: PersonaId, label: string, isOwner: boolean, perms: PermissionMap): PersonaFixture {
  return {
    id,
    label,
    isOwner,
    perms,
    can: (permission) => perms[permission] === true,
  };
}

/** 1. Owner — full authorized access (ALL_PERMISSIONS). */
export function ownerPersona(): PersonaFixture {
  return fromMap('owner', 'Owner — full access', true, { ...ALL_PERMISSIONS });
}

/** 2. Sub-user — AI enabled, sales enabled (+ typical view defaults). */
export function staffAiSellPersona(): PersonaFixture {
  const perms = normalizePermissions({
    ...DEFAULT_SUBUSER_PERMISSIONS,
    canUseZelveroAI: true,
    canSell: true,
    canViewProducts: true,
    canViewSales: true,
  });
  return fromMap('staffAiSell', 'Sub-user — AI + sell', false, perms);
}

/** 3. Sub-user — AI disabled, sales enabled. */
export function staffNoAiSellPersona(): PersonaFixture {
  const perms = normalizePermissions({
    ...DEFAULT_SUBUSER_PERMISSIONS,
    canUseZelveroAI: false,
    canSell: true,
    canViewProducts: true,
    canViewSales: true,
  });
  return fromMap('staffNoAiSell', 'Sub-user — no AI, sell ok', false, perms);
}

/** 4. Sub-user — AI enabled, sales disabled. */
export function staffAiNoSellPersona(): PersonaFixture {
  const perms = normalizePermissions({
    canUseZelveroAI: true,
    canViewProducts: true,
    canViewSales: false,
    canSell: false,
    canEditPrice: false,
  });
  return fromMap('staffAiNoSell', 'Sub-user — AI without sell', false, perms);
}

export function allPersonas(): PersonaFixture[] {
  return [ownerPersona(), staffAiSellPersona(), staffNoAiSellPersona(), staffAiNoSellPersona()];
}
