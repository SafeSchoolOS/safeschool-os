/**
 * Reads .env.example template, merges wizard values, writes .env
 */

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface WizardConfig {
  activationKey: string;
  siteName: string;
  orgName: string;
  siteId: string;
}

/**
 * Write wizard config values into the .env file.
 * Reads the existing .env (or .env.example), sets the wizard fields, preserves everything else.
 */
export function writeEnvFile(installDir: string, activationKeyEnvVar: string, config: WizardConfig): void {
  const envPath = join(installDir, '.env');
  const examplePath = join(installDir, '.env.example');

  let content: string;
  if (existsSync(envPath)) {
    content = readFileSync(envPath, 'utf-8');
  } else if (existsSync(examplePath)) {
    content = readFileSync(examplePath, 'utf-8');
  } else {
    // Build a minimal .env from scratch
    content = [
      `${activationKeyEnvVar}=`,
      'SITE_ID=',
      'SITE_NAME=',
      'ORG_NAME=',
      'DB_PASSWORD=',
      'JWT_SECRET=',
    ].join('\n') + '\n';
  }

  // Auto-generate a cloud sync key if not already present
  const syncKeyRegex = /^EDGERUNTIME_CLOUD_SYNC_KEY=.+$/m;
  if (!syncKeyRegex.test(content)) {
    const syncKey = randomBytes(32).toString('hex');
    content += `EDGERUNTIME_CLOUD_SYNC_KEY=${syncKey}\n`;
  }

  // Replace or append each wizard field
  const replacements: Record<string, string> = {
    [activationKeyEnvVar]: config.activationKey,
    SITE_ID: config.siteId,
    SITE_NAME: config.siteName,
    ORG_NAME: config.orgName,
  };

  for (const [key, value] of Object.entries(replacements)) {
    const regex = new RegExp(`^${escapeRegex(key)}=.*$`, 'm');
    if (regex.test(content)) {
      // Use function replacement to avoid $-substitution in value
      content = content.replace(regex, () => `${key}=${value}`);
    } else {
      content += `${key}=${value}\n`;
    }
  }

  writeFileSync(envPath, content, 'utf-8');

  // Write marker so the setup AP service knows config was saved and won't restart on reboot
  const markerPath = join(installDir, '.env-configured');
  writeFileSync(markerPath, new Date().toISOString() + '\n', 'utf-8');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
