import type { FeatureDefinition } from './shared/featureRelease.js';

/**
 * Present only while the Functions emulator is running.
 * They are not part of the production catalog and are never registered for Zelvero AI.
 */
export const EMULATOR_VERIFY_FEATURES: FeatureDefinition[] = [
  {
    id: 'verify_shelf_note',
    title: 'Shelf note',
    description: 'A free test update used only on the local emulator.',
    version: '1.0.0',
    icon: 'box',
    screenshots: [],
    category: 'catalog',
    classification: 'new',
    pricing: 'free',
    priceUsdCents: null,
    capabilities: ['Show a shelf note'],
    requirements: ['Store owner'],
    compatibility: 'Zelvero POS emulator',
    customerExecution: 'ready',
    navPath: null,
    navLabel: 'Shelf note',
    testingStatus: 'passed',
    activation: 'server',
    reloadRequired: true,
  },
  {
    id: 'verify_paid_label',
    title: 'Paid label',
    description: 'A paid test update used only on the local emulator.',
    version: '1.0.1',
    icon: 'box',
    screenshots: [],
    category: 'catalog',
    classification: 'new',
    pricing: 'paid',
    priceUsdCents: 1500,
    capabilities: ['Print a paid label'],
    requirements: ['Approved purchase'],
    compatibility: 'Zelvero POS emulator',
    customerExecution: 'ready',
    navPath: null,
    navLabel: 'Paid label',
    testingStatus: 'passed',
    activation: 'server',
    reloadRequired: false,
  },
];
