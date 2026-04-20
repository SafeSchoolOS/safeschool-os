import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

// Mock fs so loadConfig never touches the real filesystem
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
}));

// Mock js-yaml
vi.mock('js-yaml', () => ({
  default: {
    load: vi.fn(() => ({})),
  },
}));

// Mock the logger so it doesn't output during tests
vi.mock('@edgeruntime/core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

// Store original env so we can restore it
const originalEnv = { ...process.env };

describe('loadConfig', () => {
  beforeEach(() => {
    // Clear all EDGERUNTIME_ env vars before each test
    for (const key of Object.keys(process.env)) {
      if (
        key.startsWith('EDGERUNTIME_') ||
        key === 'OPERATING_MODE' ||
        key === 'PORT' ||
        key === 'ACCESS_CONTROL_VENDOR' ||
        key === 'ACCESS_CONTROL_URL' ||
        key === 'ACCESS_CONTROL_API_KEY' ||
        key === 'CAMERA_VENDOR' ||
        key === 'CAMERA_HOST' ||
        key === 'CAMERA_PORT' ||
        key === 'CAMERA_USERNAME' ||
        key === 'CAMERA_PASSWORD'
      ) {
        delete process.env[key];
      }
    }
    vi.clearAllMocks();
    // Default: no config file exists
    vi.mocked(existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (
        key.startsWith('EDGERUNTIME_') ||
        key === 'OPERATING_MODE' ||
        key === 'PORT' ||
        key === 'ACCESS_CONTROL_VENDOR' ||
        key === 'ACCESS_CONTROL_URL' ||
        key === 'ACCESS_CONTROL_API_KEY' ||
        key === 'CAMERA_VENDOR' ||
        key === 'CAMERA_HOST' ||
        key === 'CAMERA_PORT' ||
        key === 'CAMERA_USERNAME' ||
        key === 'CAMERA_PASSWORD'
      ) {
        delete process.env[key];
      }
    }
  });

  async function getLoadConfig() {
    // Dynamic import to pick up mocks; reset module cache each time
    vi.resetModules();
    const mod = await import('../config.js');
    return mod.loadConfig;
  }

  describe('default values', () => {
    it('should return defaults when no env vars or YAML file exist', async () => {
      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.activationKey).toBe('');
      expect(config.siteId).toBe('default-site');
      expect(config.dataDir).toBe('./data');
      expect(config.syncIntervalMs).toBe(30000);
      expect(config.healthCheckIntervalMs).toBe(15000);
      expect(config.apiPort).toBe(8470);
    });

    it('should default moduleDirs to ["./modules"]', async () => {
      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.moduleDirs).toEqual(['./modules']);
    });

    it('should have undefined operatingMode by default', async () => {
      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.operatingMode).toBeUndefined();
    });
  });

  describe('environment variable overrides', () => {
    it('should override activationKey from EDGERUNTIME_ACTIVATION_KEY', async () => {
      process.env.EDGERUNTIME_ACTIVATION_KEY = 'ABCD-1234-EFGH-5678';
      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.activationKey).toBe('ABCD-1234-EFGH-5678');
    });

    it('should override siteId from EDGERUNTIME_SITE_ID', async () => {
      process.env.EDGERUNTIME_SITE_ID = 'my-site';
      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.siteId).toBe('my-site');
    });

    it('should override dataDir from EDGERUNTIME_DATA_DIR', async () => {
      process.env.EDGERUNTIME_DATA_DIR = '/opt/edgeruntime/data';
      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.dataDir).toBe('/opt/edgeruntime/data');
    });

    it('should override syncIntervalMs from EDGERUNTIME_SYNC_INTERVAL_MS', async () => {
      process.env.EDGERUNTIME_SYNC_INTERVAL_MS = '60000';
      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.syncIntervalMs).toBe(60000);
    });

    it('should override healthCheckIntervalMs from EDGERUNTIME_HEALTH_CHECK_INTERVAL_MS', async () => {
      process.env.EDGERUNTIME_HEALTH_CHECK_INTERVAL_MS = '5000';
      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.healthCheckIntervalMs).toBe(5000);
    });

    it('should override apiPort from EDGERUNTIME_API_PORT', async () => {
      process.env.EDGERUNTIME_API_PORT = '9090';
      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.apiPort).toBe(9090);
    });

    it('should fall back to PORT env var for apiPort (Railway convention)', async () => {
      process.env.PORT = '3000';
      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.apiPort).toBe(3000);
    });

    it('should prefer EDGERUNTIME_API_PORT over PORT', async () => {
      process.env.EDGERUNTIME_API_PORT = '9090';
      process.env.PORT = '3000';
      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.apiPort).toBe(9090);
    });

    it('should override orgId from EDGERUNTIME_ORG_ID', async () => {
      process.env.EDGERUNTIME_ORG_ID = 'org-123';
      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.orgId).toBe('org-123');
    });

    it('should parse EDGERUNTIME_MODULE_DIRS as comma-separated list', async () => {
      process.env.EDGERUNTIME_MODULE_DIRS = './modules,./plugins,./custom';
      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.moduleDirs).toEqual(['./modules', './plugins', './custom']);
    });
  });

  describe('envInt helper (via config fields)', () => {
    it('should ignore non-numeric EDGERUNTIME_SYNC_INTERVAL_MS', async () => {
      process.env.EDGERUNTIME_SYNC_INTERVAL_MS = 'not-a-number';
      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      // Should fall through to default
      expect(config.syncIntervalMs).toBe(30000);
    });

    it('should ignore empty string for integer env vars', async () => {
      process.env.EDGERUNTIME_API_PORT = '';
      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      // parseInt('', 10) is NaN, so should fall through to default
      expect(config.apiPort).toBe(8470);
    });

    it('should parse valid integer strings', async () => {
      process.env.EDGERUNTIME_API_PORT = '1234';
      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.apiPort).toBe(1234);
    });
  });

  describe('operating mode detection', () => {
    it('should set operatingMode from OPERATING_MODE env var', async () => {
      process.env.OPERATING_MODE = 'CLOUD';
      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.operatingMode).toBe('CLOUD');
    });

    it('should uppercase the OPERATING_MODE value', async () => {
      process.env.OPERATING_MODE = 'edge';
      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.operatingMode).toBe('EDGE');
    });

    it('should accept MIRROR operating mode', async () => {
      process.env.OPERATING_MODE = 'mirror';
      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.operatingMode).toBe('MIRROR');
    });
  });

  describe('YAML file loading', () => {
    it('should load config from YAML when file exists', async () => {
      const yaml = await import('js-yaml');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('siteId: yaml-site\napiPort: 9999');
      vi.mocked(yaml.default.load).mockReturnValue({
        siteId: 'yaml-site',
        apiPort: 9999,
      });

      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.siteId).toBe('yaml-site');
      expect(config.apiPort).toBe(9999);
    });

    it('should prioritize env vars over YAML values', async () => {
      const yaml = await import('js-yaml');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('siteId: yaml-site');
      vi.mocked(yaml.default.load).mockReturnValue({ siteId: 'yaml-site' });

      process.env.EDGERUNTIME_SITE_ID = 'env-site';

      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.siteId).toBe('env-site');
    });
  });

  describe('connector auto-configuration', () => {
    it('should auto-create PACS connector from ACCESS_CONTROL env vars', async () => {
      process.env.ACCESS_CONTROL_VENDOR = 'sicunet';
      process.env.ACCESS_CONTROL_URL = 'https://pacs.local';
      process.env.ACCESS_CONTROL_API_KEY = 'key123';

      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.connectors).toHaveLength(1);
      expect(config.connectors![0].name).toBe('sicunet-pacs');
      expect(config.connectors![0].type).toBe('lenel-onguard');
      expect(config.connectors![0].enabled).toBe(true);
      expect(config.connectors![0].apiUrl).toBe('https://pacs.local');
      expect(config.connectors![0].apiKey).toBe('key123');
    });

    it('should auto-create camera connector from CAMERA env vars', async () => {
      process.env.CAMERA_VENDOR = 'milestone';
      process.env.CAMERA_HOST = 'vms.local';
      process.env.CAMERA_PORT = '8443';
      process.env.CAMERA_USERNAME = 'admin';
      process.env.CAMERA_PASSWORD = 'secret';

      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.connectors).toHaveLength(1);
      expect(config.connectors![0].name).toBe('milestone-vms');
      expect(config.connectors![0].type).toBe('milestone-xprotect');
      expect(config.connectors![0].serverUrl).toBe('https://vms.local:8443');
    });

    it('should return empty connectors when no connector env vars set', async () => {
      const loadConfig = await getLoadConfig();
      const config = loadConfig();

      expect(config.connectors).toEqual([]);
    });
  });
});
