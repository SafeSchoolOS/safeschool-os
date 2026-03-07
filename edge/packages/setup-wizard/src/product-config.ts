/**
 * Per-product configuration for the setup wizard.
 */

export interface ProductConfig {
  label: string;
  activationKeyEnvVar: string;
  accentColor: string;
  defaultSiteName: string;
  defaultOrgName: string;
}

export const PRODUCT_CONFIGS: Record<string, ProductConfig> = {
  safeschool: {
    label: 'SafeSchoolOS',
    activationKeyEnvVar: 'EDGERUNTIME_ACTIVATION_KEY',
    accentColor: '#2196F3',
    defaultSiteName: '',
    defaultOrgName: '',
  },
};

export function getProductConfig(): ProductConfig {
  const product = process.env.WIZARD_PRODUCT ?? 'safeschool';
  const config = PRODUCT_CONFIGS[product];
  if (!config) {
    console.error(`Unknown product: ${product}. Falling back to safeschool.`);
    return PRODUCT_CONFIGS['safeschool']!;
  }
  return config;
}

export function getProductSlug(): string {
  return process.env.WIZARD_PRODUCT ?? 'safeschool';
}
