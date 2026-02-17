import { FastifyInstance } from 'fastify';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import os from 'os';

const ENV_FILE = process.env.EDGE_ENV_FILE || '/app/deploy/edge/.env';

// Pattern-based redaction — catches all current and future secrets
const SENSITIVE_PATTERN = /SECRET|KEY|TOKEN|PASSWORD|HASH|CREDENTIAL|AUTH/i;

// Keep legacy set for backwards compat, but pattern covers everything
const REDACTED_KEYS = new Set([
  'DB_PASSWORD',
  'JWT_SECRET',
  'FR_JWT_SECRET',
  'CLOUD_SYNC_KEY',
  'RAPIDSOS_CLIENT_SECRET',
  'RAVE_API_KEY',
  'AC_API_KEY',
  'TWILIO_AUTH_TOKEN',
  'SENDGRID_API_KEY',
  'CLERK_WEBHOOK_SECRET',
  'GITHUB_TOKEN',
  'CENTEGIX_WEBHOOK_SECRET',
  'ZEROEYES_WEBHOOK_SECRET',
  'BARK_API_KEY',
]);

function isSensitiveKey(key: string): boolean {
  return REDACTED_KEYS.has(key) || SENSITIVE_PATTERN.test(key);
}

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
      value: isSensitiveKey(key) ? '***redacted***' : value,
      redacted: isSensitiveKey(key),
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

const BACKUP_DIR = process.env.BACKUP_DIR || '/opt/safeschool/backups';

function listBackupFiles(): Array<{ filename: string; category: string; size: number; date: string }> {
  const results: Array<{ filename: string; category: string; size: number; date: string }> = [];

  for (const category of ['daily', 'weekly']) {
    const dir = path.join(BACKUP_DIR, category);
    if (!existsSync(dir)) continue;

    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.sql.gz'));
      for (const file of files) {
        try {
          const filePath = path.join(dir, file);
          const stats = statSync(filePath);
          results.push({
            filename: file,
            category,
            size: stats.size,
            date: stats.mtime.toISOString(),
          });
        } catch {
          // Skip files we can't stat
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  // Sort by date descending (newest first)
  results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return results;
}

export default async function adminRoutes(app: FastifyInstance) {
  // Require SITE_ADMIN+ for ALL admin routes
  app.addHook('onRequest', async (request, reply) => {
    try {
      await (request as any).jwtVerify();
      const role = (request as any).jwtUser?.role;
      if (role !== 'SITE_ADMIN' && role !== 'SUPER_ADMIN') {
        return reply.code(403).send({ error: 'Forbidden: SITE_ADMIN or higher required' });
      }
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

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
    // Try version.json first (written during ISO first-boot or update)
    const versionFile = '/etc/safeschool/version.json';
    if (existsSync(versionFile)) {
      try {
        const versionData = JSON.parse(readFileSync(versionFile, 'utf-8'));
        return {
          version: versionData.version || versionData.tag || 'unknown',
          tag: versionData.tag || null,
          commit: versionData.commit || null,
          buildDate: versionData.buildDate || null,
          installedAt: versionData.installedAt || null,
        };
      } catch {
        // Fall through to git
      }
    }

    // Fall back to git (works if repo was cloned, not for air-gapped ISO installs)
    try {
      const installDir = process.env.EDGE_INSTALL_DIR || '/opt/safeschool';
      const currentCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8', cwd: installDir }).trim();
      const currentMessage = execSync('git log --oneline -1', { encoding: 'utf-8', cwd: installDir }).trim();
      return {
        version: currentCommit,
        tag: null,
        commit: currentCommit,
        buildDate: null,
        installedAt: null,
        message: currentMessage,
      };
    } catch {
      return { version: 'unknown', tag: null, commit: null, buildDate: null };
    }
  });

  // GET /api/v1/admin/releases — list available releases from GitHub
  app.get('/releases', async (_request, reply) => {
    const GITHUB_REPO = 'bwattendorf/safeSchool';
    const token = process.env.GITHUB_TOKEN;
    try {
      const url = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=5`;
      const headers: Record<string, string> = {
        'User-Agent': 'SafeSchool-Edge',
        'Accept': 'application/vnd.github.v3+json',
      };
      if (token) headers['Authorization'] = `token ${token}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`GitHub API ${res.status}: ${errText.slice(0, 200)}`);
      }
      const data = await res.json() as any[];
      return {
        releases: data.map((r) => ({
          tag: r.tag_name,
          name: r.name,
          published: r.published_at,
          prerelease: r.prerelease,
          body: r.body?.slice(0, 500) || '',
          assets: (r.assets || []).length,
        })),
      };
    } catch (err: any) {
      reply.code(200); // Still 200 — just no releases available
      return { releases: [], error: err.message };
    }
  });

  // POST /api/v1/admin/update — pull latest images and restart containers
  app.post('/update', async (request) => {
    try {
      const { tag } = (request.body as { tag?: string }) || {};
      const composeDir = process.env.EDGE_COMPOSE_DIR || '/opt/safeschool/deploy/edge';
      const envFile = process.env.EDGE_ENV_FILE || '/opt/safeschool/deploy/edge/.env';

      // Pull latest Docker images
      app.log.info(`Starting update${tag ? ` to ${tag}` : ' to latest'}...`);
      execSync(`docker compose --env-file ${envFile} pull`, {
        encoding: 'utf-8', cwd: composeDir, timeout: 300000,
      });

      // Restart services with new images
      execSync(`docker compose --env-file ${envFile} up -d`, {
        encoding: 'utf-8', cwd: composeDir, timeout: 300000,
      });

      // Cleanup old images
      try {
        execSync('docker image prune -f', { encoding: 'utf-8', timeout: 30000 });
      } catch {
        // Non-critical
      }

      // Update version.json if tag provided
      if (tag) {
        const versionFile = '/etc/safeschool/version.json';
        try {
          const versionData = existsSync(versionFile)
            ? JSON.parse(readFileSync(versionFile, 'utf-8'))
            : {};
          versionData.version = tag;
          versionData.tag = tag;
          versionData.updatedAt = new Date().toISOString();
          writeFileSync(versionFile, JSON.stringify(versionData, null, 2), 'utf-8');
        } catch {
          // Non-critical
        }
      }

      return { message: `Update complete${tag ? ` (${tag})` : ''}. Services are restarting.`, tag: tag || 'latest' };
    } catch (err: any) {
      return { statusCode: 500, message: `Update failed: ${err.message}` };
    }
  });

  // GET /api/v1/admin/backups — list available database backups
  app.get('/backups', async () => {
    return { backups: listBackupFiles() };
  });

  // POST /api/v1/admin/backups — trigger an immediate database backup
  app.post('/backups', async (request, reply) => {
    const composeDir = process.env.EDGE_COMPOSE_DIR || '/app/deploy/edge';

    try {
      // Get the postgres container ID
      const containerId = execSync(
        'docker compose ps -q postgres',
        { encoding: 'utf-8', cwd: composeDir }
      ).trim();

      if (!containerId) {
        reply.code(503);
        return { statusCode: 503, message: 'PostgreSQL container is not running' };
      }

      const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      const backupFile = `safeschool_${timestamp}.sql.gz`;
      const dailyDir = path.join(BACKUP_DIR, 'daily');

      // Ensure backup directory exists
      execSync(`mkdir -p ${dailyDir}`, { encoding: 'utf-8' });

      // Run pg_dump inside the postgres container
      execSync(
        `docker exec ${containerId} pg_dump -U safeschool -d safeschool --format=custom --compress=6 --no-owner --no-acl > ${path.join(dailyDir, backupFile)}`,
        { encoding: 'utf-8', timeout: 120000 }
      );

      // Verify the backup file is not empty
      const stats = statSync(path.join(dailyDir, backupFile));
      if (stats.size === 0) {
        execSync(`rm -f ${path.join(dailyDir, backupFile)}`, { encoding: 'utf-8' });
        reply.code(500);
        return { statusCode: 500, message: 'Backup file is empty. pg_dump may have failed.' };
      }

      // Rotate daily backups: keep only 7
      try {
        const dailyFiles = readdirSync(dailyDir)
          .filter((f) => f.startsWith('safeschool_') && f.endsWith('.sql.gz'))
          .map((f) => ({ name: f, mtime: statSync(path.join(dailyDir, f)).mtime.getTime() }))
          .sort((a, b) => b.mtime - a.mtime);

        for (const old of dailyFiles.slice(7)) {
          execSync(`rm -f ${path.join(dailyDir, old.name)}`, { encoding: 'utf-8' });
        }
      } catch {
        // Rotation failure is non-critical
      }

      return {
        message: 'Backup created successfully',
        backup: {
          filename: backupFile,
          category: 'daily',
          size: stats.size,
          date: stats.mtime.toISOString(),
        },
      };
    } catch (err: any) {
      reply.code(500);
      return { statusCode: 500, message: `Backup failed: ${err.message}` };
    }
  });

  // POST /api/v1/admin/backups/restore — restore database from a specific backup
  app.post('/backups/restore', async (request, reply) => {
    const { filename } = request.body as { filename: string };

    // Validate filename to prevent path traversal
    if (!filename || !/^safeschool_[\w]+\.sql\.gz$/.test(filename)) {
      reply.code(400);
      return { statusCode: 400, message: 'Invalid backup filename' };
    }

    // Find the backup file in daily or weekly directories
    let backupPath = '';
    for (const category of ['daily', 'weekly']) {
      const candidate = path.join(BACKUP_DIR, category, filename);
      if (existsSync(candidate)) {
        backupPath = candidate;
        break;
      }
    }

    if (!backupPath) {
      reply.code(404);
      return { statusCode: 404, message: `Backup file not found: ${filename}` };
    }

    const composeDir = process.env.EDGE_COMPOSE_DIR || '/app/deploy/edge';

    try {
      // Get the postgres container ID
      const containerId = execSync(
        'docker compose ps -q postgres',
        { encoding: 'utf-8', cwd: composeDir }
      ).trim();

      if (!containerId) {
        reply.code(503);
        return { statusCode: 503, message: 'PostgreSQL container is not running' };
      }

      // Create a pre-restore safety backup
      const preRestoreTimestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      const preRestoreFile = path.join(BACKUP_DIR, 'daily', `safeschool_pre_restore_${preRestoreTimestamp}.sql.gz`);
      try {
        execSync(
          `docker exec ${containerId} pg_dump -U safeschool -d safeschool --format=custom --compress=6 --no-owner --no-acl > ${preRestoreFile}`,
          { encoding: 'utf-8', timeout: 120000 }
        );
      } catch {
        // Pre-restore backup failure is non-fatal
      }

      // Stop API and worker containers
      execSync('docker compose stop api worker', {
        encoding: 'utf-8',
        cwd: composeDir,
        timeout: 60000,
      });

      // Terminate active connections and recreate the database
      execSync(
        `docker exec ${containerId} psql -U safeschool -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'safeschool' AND pid <> pg_backend_pid();"`,
        { encoding: 'utf-8' }
      );
      execSync(
        `docker exec ${containerId} psql -U safeschool -d postgres -c "DROP DATABASE IF EXISTS safeschool;"`,
        { encoding: 'utf-8' }
      );
      execSync(
        `docker exec ${containerId} psql -U safeschool -d postgres -c "CREATE DATABASE safeschool OWNER safeschool;"`,
        { encoding: 'utf-8' }
      );

      // Restore from backup
      execSync(
        `docker exec -i ${containerId} pg_restore -U safeschool -d safeschool --no-owner --no-acl --clean --if-exists < ${backupPath}`,
        { encoding: 'utf-8', timeout: 300000 }
      );

      // Restart API and worker
      execSync('docker compose start api worker', {
        encoding: 'utf-8',
        cwd: composeDir,
        timeout: 60000,
      });

      // Wait briefly and check health
      await new Promise((resolve) => setTimeout(resolve, 5000));

      let apiHealthy = false;
      try {
        const healthStatus = execSync(
          'docker compose ps --format "{{.Health}}" api',
          { encoding: 'utf-8', cwd: composeDir }
        ).trim();
        apiHealthy = healthStatus === 'healthy';
      } catch {
        // Health check may not be ready yet
      }

      return {
        message: 'Database restored successfully. Services are restarting.',
        restoredFrom: filename,
        preRestoreBackup: path.basename(preRestoreFile),
        apiHealthy,
      };
    } catch (err: any) {
      // Attempt to restart services even if restore failed
      try {
        execSync('docker compose start api worker', {
          encoding: 'utf-8',
          cwd: composeDir,
          timeout: 60000,
        });
      } catch {
        // Best effort restart
      }

      reply.code(500);
      return { statusCode: 500, message: `Restore failed: ${err.message}` };
    }
  });
}
