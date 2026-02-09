import { FastifyInstance } from 'fastify';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import os from 'os';

const ENV_FILE = process.env.EDGE_ENV_FILE || '/app/deploy/edge/.env';

// Keys that should be redacted in config responses
const REDACTED_KEYS = new Set([
  'DB_PASSWORD',
  'JWT_SECRET',
  'CLOUD_SYNC_KEY',
  'RAPIDSOS_CLIENT_SECRET',
  'RAVE_API_KEY',
  'AC_API_KEY',
  'TWILIO_AUTH_TOKEN',
  'SENDGRID_API_KEY',
]);

function parseEnvFile(path: string): Array<{ key: string; value: string; redacted: boolean }> {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf-8');
  const entries: Array<{ key: string; value: string; redacted: boolean }> = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    entries.push({
      key,
      value: REDACTED_KEYS.has(key) ? '***redacted***' : value,
      redacted: REDACTED_KEYS.has(key),
    });
  }

  return entries;
}

function updateEnvFile(path: string, updates: Record<string, string>): void {
  let content = '';
  if (existsSync(path)) {
    content = readFileSync(path, 'utf-8');
  }

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
  }

  writeFileSync(path, content, 'utf-8');
}

function getDiskUsage(): { total: number; used: number; free: number } {
  try {
    const output = execSync("df -B1 / | tail -1", { encoding: 'utf-8' });
    const parts = output.trim().split(/\s+/);
    return {
      total: parseInt(parts[1]) || 0,
      used: parseInt(parts[2]) || 0,
      free: parseInt(parts[3]) || 0,
    };
  } catch {
    return { total: 0, used: 0, free: 0 };
  }
}

function getDockerServices(): Array<{ name: string; status: string; uptime: string; ports: string }> {
  try {
    const output = execSync(
      'docker compose ps --format "{{.Name}}|{{.Status}}|{{.Ports}}"',
      { encoding: 'utf-8', cwd: process.env.EDGE_COMPOSE_DIR || '/app/deploy/edge' }
    );
    return output.trim().split('\n').filter(Boolean).map((line) => {
      const [name, status, ports] = line.split('|');
      // Extract uptime from status like "Up 2 hours (healthy)"
      const uptimeMatch = status?.match(/Up\s+(.+?)(?:\s+\(|$)/);
      return {
        name: name || '',
        status: status?.includes('healthy') ? 'healthy' : status?.includes('Up') ? 'running' : 'stopped',
        uptime: uptimeMatch?.[1] || '',
        ports: ports || '',
      };
    });
  } catch {
    return [];
  }
}

function getDockerLogs(service: string): Array<{ timestamp: string; message: string }> {
  try {
    const output = execSync(
      `docker compose logs --tail=100 --no-color ${service}`,
      { encoding: 'utf-8', cwd: process.env.EDGE_COMPOSE_DIR || '/app/deploy/edge' }
    );
    return output.trim().split('\n').filter(Boolean).map((line) => {
      const match = line.match(/^[^\s]+\s+\|\s*([\d\-T:.Z]+)?\s*(.*)/);
      return {
        timestamp: match?.[1] || '',
        message: match?.[2] || line,
      };
    });
  } catch {
    return [];
  }
}

export default async function adminRoutes(app: FastifyInstance) {
  // GET /api/v1/admin/status — system health overview
  app.get('/status', async () => {
    const mem = os.totalmem();
    const free = os.freemem();
    const disk = getDiskUsage();

    return {
      uptime: process.uptime(),
      memory: {
        total: mem,
        used: mem - free,
        free: free,
      },
      disk,
      operatingMode: process.env.OPERATING_MODE || 'edge',
      nodeVersion: process.version,
      services: getDockerServices().map((s) => ({ name: s.name, status: s.status })),
    };
  });

  // GET /api/v1/admin/sync — sync engine state
  app.get('/sync', async () => {
    return {
      mode: process.env.OPERATING_MODE || 'edge',
      connected: !!process.env.CLOUD_SYNC_URL,
      lastSyncAt: null, // TODO: wire to edge sync engine getSyncState()
      pendingChanges: 0,
      queueSize: 0,
      cloudUrl: process.env.CLOUD_SYNC_URL || null,
    };
  });

  // GET /api/v1/admin/config — current .env config (secrets redacted)
  app.get('/config', async () => {
    return { config: parseEnvFile(ENV_FILE) };
  });

  // POST /api/v1/admin/config — update .env values
  app.post('/config', async (request) => {
    const updates = request.body as Record<string, string>;
    // Don't allow overwriting redacted keys via the config endpoint without explicit values
    for (const key of Object.keys(updates)) {
      if (REDACTED_KEYS.has(key) && !updates[key]) {
        delete updates[key];
      }
    }
    updateEnvFile(ENV_FILE, updates);
    return { message: 'Configuration updated. Restart services to apply changes.' };
  });

  // GET /api/v1/admin/services — docker container statuses
  app.get('/services', async () => {
    return { services: getDockerServices() };
  });

  // POST /api/v1/admin/services/:name/restart — restart a container
  app.post('/services/:name/restart', async (request) => {
    const { name } = request.params as { name: string };
    // Validate service name to prevent injection
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return { statusCode: 400, message: 'Invalid service name' };
    }
    try {
      execSync(`docker compose restart ${name}`, {
        encoding: 'utf-8',
        cwd: process.env.EDGE_COMPOSE_DIR || '/app/deploy/edge',
      });
      return { message: `Service ${name} restarted successfully` };
    } catch (err: any) {
      return { statusCode: 500, message: `Failed to restart ${name}: ${err.message}` };
    }
  });

  // GET /api/v1/admin/logs/:service — recent logs
  app.get('/logs/:service', async (request) => {
    const { service } = request.params as { service: string };
    if (!/^[a-zA-Z0-9_-]+$/.test(service)) {
      return { statusCode: 400, message: 'Invalid service name' };
    }
    return { logs: getDockerLogs(service) };
  });

  // GET /api/v1/admin/version — current version info
  app.get('/version', async () => {
    try {
      const installDir = process.env.EDGE_INSTALL_DIR || '/opt/safeschool';
      const currentCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8', cwd: installDir }).trim();
      const currentMessage = execSync('git log --oneline -1', { encoding: 'utf-8', cwd: installDir }).trim();
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8', cwd: installDir }).trim();

      // Check for available updates
      let updateAvailable = false;
      let remoteCommit = '';
      try {
        execSync('git fetch origin main --quiet', { encoding: 'utf-8', cwd: installDir, timeout: 10000 });
        remoteCommit = execSync('git rev-parse --short origin/main', { encoding: 'utf-8', cwd: installDir }).trim();
        updateAvailable = currentCommit !== remoteCommit;
      } catch {
        // Fetch failed — offline or network issue
      }

      return {
        version: currentCommit,
        message: currentMessage,
        branch,
        updateAvailable,
        remoteVersion: remoteCommit || null,
      };
    } catch {
      return { version: 'unknown', updateAvailable: false };
    }
  });

  // POST /api/v1/admin/update — pull latest code, run migrations, rebuild containers
  app.post('/update', async () => {
    try {
      const installDir = process.env.EDGE_INSTALL_DIR || '/opt/safeschool';
      const composeDir = process.env.EDGE_COMPOSE_DIR || '/app/deploy/edge';
      const envFile = process.env.EDGE_ENV_FILE || '/app/deploy/edge/.env';

      // Pull latest code
      execSync('git pull --ff-only origin main', { encoding: 'utf-8', cwd: installDir, timeout: 60000 });
      const newVersion = execSync('git log --oneline -1', { encoding: 'utf-8', cwd: installDir }).trim();

      // Run migrations
      try {
        execSync(`docker compose -f ${installDir}/deploy/edge/docker-compose.yml --env-file ${envFile} run --rm migrate`, {
          encoding: 'utf-8', timeout: 120000,
        });
      } catch (migErr: any) {
        // Migrations may not be needed for every update
        app.log.warn(`Migration step: ${migErr.message}`);
      }

      // Rebuild and restart
      execSync('docker compose pull', { encoding: 'utf-8', cwd: composeDir, timeout: 300000 });
      execSync('docker compose up -d --build', { encoding: 'utf-8', cwd: composeDir, timeout: 300000 });

      // Cleanup
      try {
        execSync('docker image prune -f', { encoding: 'utf-8', timeout: 30000 });
      } catch {
        // Non-critical
      }

      return { message: 'Update complete. Services are restarting.', version: newVersion };
    } catch (err: any) {
      return { statusCode: 500, message: `Update failed: ${err.message}` };
    }
  });
}
