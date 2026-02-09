/**
 * S2 NetBox Access Control Adapter
 *
 * Integrates with S2 NetBox (LenelS2) via the NBAPI (NetBox API).
 * Protocol: XML over HTTP POST to /goforms/nbapi
 * Auth: Session-based (Login command returns sessionid for subsequent requests)
 *
 * Supports: door lock/unlock/momentary-unlock, threat level lockdown, portal status.
 * S2 NetBox uses "portals" (doors) and "threat levels" (lockdown states).
 *
 * API Reference: Web-Based API for S2 NetBox (NBAPI), LenelS2 Feb 2020
 * @see https://github.com/Teamsquare/s2_netbox (Ruby wrapper)
 * @see https://github.com/bordwalk2000/LenelS2-NetBox (PowerShell wrapper)
 */

import {
  DoorStatus,
  type AccessControlAdapter,
  type AccessControlConfig,
  type DoorCommandResult,
  type DoorEvent,
  type LockdownResult,
} from '@safeschool/core';

interface NbapiResponse {
  success: boolean;
  code: string;
  details: Record<string, any>;
  errorMessage?: string;
}

export class S2NetBoxAdapter implements AccessControlAdapter {
  name = 'S2 NetBox';
  vendor = 'LenelS2';

  private baseUrl = '';
  private protocol = 'https://';
  private username = '';
  private password = '';
  private sessionId = '';
  private connected = false;
  private lockdownThreatLevel = 'LOCKDOWN';
  private normalThreatLevel = 'NORMAL';
  private eventCallbacks: ((event: DoorEvent) => void)[] = [];

  async connect(config: AccessControlConfig): Promise<void> {
    this.baseUrl = config.apiUrl || '';
    this.username = config.username || '';
    this.password = config.password || '';
    this.lockdownThreatLevel = (config.options?.lockdownThreatLevel as string) || 'LOCKDOWN';
    this.normalThreatLevel = (config.options?.normalThreatLevel as string) || 'NORMAL';

    if (this.baseUrl.startsWith('http://') || this.baseUrl.startsWith('https://')) {
      this.protocol = '';
    }

    await this.login();

    const healthy = await this.healthCheck();
    if (!healthy) {
      throw new Error('Failed to connect to S2 NetBox');
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.sessionId) {
      try {
        await this.sendCommand('Logout');
      } catch {
        // Best effort logout
      }
    }
    this.sessionId = '';
    this.connected = false;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.sendCommand('GetAPIVersion');
      return result.success;
    } catch {
      return false;
    }
  }

  async lockDoor(doorId: string): Promise<DoorCommandResult> {
    const start = Date.now();
    try {
      const result = await this.sendCommand('LockPortal', {
        PORTALKEY: doorId,
      });

      return {
        success: result.success,
        doorId,
        newStatus: DoorStatus.LOCKED,
        executionTimeMs: Date.now() - start,
        error: result.errorMessage,
      };
    } catch (err) {
      return {
        success: false,
        doorId,
        newStatus: DoorStatus.UNKNOWN,
        executionTimeMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  async unlockDoor(doorId: string): Promise<DoorCommandResult> {
    const start = Date.now();
    try {
      const result = await this.sendCommand('MomentaryUnlockPortal', {
        PORTALKEY: doorId,
      });

      return {
        success: result.success,
        doorId,
        newStatus: DoorStatus.UNLOCKED,
        executionTimeMs: Date.now() - start,
        error: result.errorMessage,
      };
    } catch (err) {
      return {
        success: false,
        doorId,
        newStatus: DoorStatus.UNKNOWN,
        executionTimeMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  async lockdownBuilding(_buildingId: string): Promise<LockdownResult> {
    const start = Date.now();
    try {
      // S2 NetBox uses threat levels for facility-wide lockdown
      const result = await this.sendCommand('SetThreatLevel', {
        THREATLEVELNAME: this.lockdownThreatLevel,
      });

      if (!result.success) {
        return {
          lockdownId: this.lockdownThreatLevel,
          status: 'PARTIAL_FAILURE',
          doorsLocked: 0,
          doorsFailed: [{ doorId: 'all', doorName: 'Building', reason: result.errorMessage || 'SetThreatLevel failed' }],
          timeToCompleteMs: Date.now() - start,
          timestamp: new Date(),
        };
      }

      return {
        lockdownId: this.lockdownThreatLevel,
        status: 'COMPLETE',
        doorsLocked: 0, // S2 NetBox doesn't return count; threat level applies globally
        doorsFailed: [],
        timeToCompleteMs: Date.now() - start,
        timestamp: new Date(),
      };
    } catch (err) {
      return {
        lockdownId: '',
        status: 'PARTIAL_FAILURE',
        doorsLocked: 0,
        doorsFailed: [{ doorId: 'all', doorName: 'Building', reason: err instanceof Error ? err.message : 'Connection failed' }],
        timeToCompleteMs: Date.now() - start,
        timestamp: new Date(),
      };
    }
  }

  async lockdownZone(zoneId: string): Promise<LockdownResult> {
    // S2 NetBox threat levels are system-wide; zone lockdown maps to the same mechanism
    return this.lockdownBuilding(zoneId);
  }

  async releaseLockdown(_lockdownId: string): Promise<LockdownResult> {
    const start = Date.now();
    try {
      await this.sendCommand('SetThreatLevel', {
        THREATLEVELNAME: this.normalThreatLevel,
      });

      return {
        lockdownId: this.normalThreatLevel,
        status: 'COMPLETE',
        doorsLocked: 0,
        doorsFailed: [],
        timeToCompleteMs: Date.now() - start,
        timestamp: new Date(),
      };
    } catch (err) {
      return {
        lockdownId: '',
        status: 'PARTIAL_FAILURE',
        doorsLocked: 0,
        doorsFailed: [{ doorId: 'all', doorName: 'All', reason: err instanceof Error ? err.message : 'Failed to release' }],
        timeToCompleteMs: Date.now() - start,
        timestamp: new Date(),
      };
    }
  }

  async getDoorStatus(doorId: string): Promise<DoorStatus> {
    try {
      const result = await this.sendCommand('GetPortal', {
        PORTALKEY: doorId,
      });

      if (!result.success) return DoorStatus.UNKNOWN;

      const status = result.details?.STATUS || result.details?.PORTALSTATUS || '';
      return this.mapPortalStatus(status);
    } catch {
      return DoorStatus.UNKNOWN;
    }
  }

  async getAllDoorStatuses(): Promise<Map<string, DoorStatus>> {
    const statuses = new Map<string, DoorStatus>();

    try {
      const result = await this.sendCommand('GetPortals');
      if (!result.success) return statuses;

      const portals = Array.isArray(result.details?.PORTALS)
        ? result.details.PORTALS
        : result.details?.PORTAL
          ? [result.details.PORTAL]
          : [];

      for (const portal of portals) {
        const key = portal.PORTALKEY || portal.KEY;
        const status = portal.STATUS || portal.PORTALSTATUS || '';
        if (key) {
          statuses.set(key, this.mapPortalStatus(status));
        }
      }
    } catch (err) {
      console.error('[S2NetBoxAdapter] GetPortals failed:', err);
    }

    return statuses;
  }

  onDoorEvent(callback: (event: DoorEvent) => void): void {
    this.eventCallbacks.push(callback);
  }

  // ── NBAPI XML Transport ──────────────────────────────────────────

  private async login(): Promise<void> {
    const xml = this.buildXml('Login', {
      USERNAME: this.username,
      PASSWORD: this.password,
    }, false);

    const responseText = await this.postXml(xml);
    const parsed = this.parseResponse(responseText);

    // Extract sessionid from the root NETBOX element
    const sessionMatch = responseText.match(/sessionid="([^"]+)"/i);
    if (sessionMatch) {
      this.sessionId = sessionMatch[1];
    } else if (!parsed.success) {
      throw new Error(`S2 NetBox login failed: ${parsed.errorMessage || parsed.code}`);
    }
  }

  private async sendCommand(commandName: string, params?: Record<string, string>): Promise<NbapiResponse> {
    const xml = this.buildXml(commandName, params);
    const responseText = await this.postXml(xml);
    const parsed = this.parseResponse(responseText);

    // Re-authenticate on session expiry
    if (parsed.code === 'FAIL' && parsed.errorMessage?.includes('session')) {
      await this.login();
      const retryXml = this.buildXml(commandName, params);
      const retryText = await this.postXml(retryXml);
      return this.parseResponse(retryText);
    }

    return parsed;
  }

  private buildXml(commandName: string, params?: Record<string, string>, includeSession = true): string {
    const sessionAttr = includeSession && this.sessionId
      ? ` sessionid="${this.escapeXml(this.sessionId)}"`
      : '';

    let paramsXml = '';
    if (params && Object.keys(params).length > 0) {
      const paramEntries = Object.entries(params)
        .map(([key, value]) => `<${key}>${this.escapeXml(value)}</${key}>`)
        .join('');
      paramsXml = `<PARAMS>${paramEntries}</PARAMS>`;
    }

    return `<NETBOX-API${sessionAttr}><COMMAND name="${commandName}" num="1" dateformat="tzoffset">${paramsXml}</COMMAND></NETBOX-API>`;
  }

  private async postXml(xml: string): Promise<string> {
    const url = `${this.protocol}${this.baseUrl}/goforms/nbapi`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'X-Integration': 'SafeSchool',
      },
      body: xml,
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`S2 NetBox HTTP error: ${response.status}`);
    }

    return response.text();
  }

  private parseResponse(xml: string): NbapiResponse {
    // Parse the NBAPI XML response:
    // <NETBOX sessionid="..."><RESPONSE command="..." num="1">
    //   <CODE>SUCCESS|FAIL</CODE>
    //   <DETAILS>...</DETAILS>
    //   <ERRORMESSAGE>...</ERRORMESSAGE>
    // </RESPONSE></NETBOX>

    const codeMatch = xml.match(/<CODE>([^<]*)<\/CODE>/i);
    const code = codeMatch ? codeMatch[1].trim() : 'UNKNOWN';

    const errorMatch = xml.match(/<ERRORMESSAGE>([^<]*)<\/ERRORMESSAGE>/i);
    const errorMessage = errorMatch ? errorMatch[1].trim() : undefined;

    const details = this.parseDetails(xml);

    return {
      success: code === 'SUCCESS',
      code,
      details,
      errorMessage,
    };
  }

  private parseDetails(xml: string): Record<string, any> {
    const detailsMatch = xml.match(/<DETAILS>([\s\S]*?)<\/DETAILS>/i);
    if (!detailsMatch) return {};

    const detailsXml = detailsMatch[1];
    const result: Record<string, any> = {};

    // Parse simple key-value elements within DETAILS
    const tagPattern = /<([A-Z_]+)>([^<]*)<\/\1>/gi;
    let match;
    while ((match = tagPattern.exec(detailsXml)) !== null) {
      result[match[1].toUpperCase()] = match[2].trim();
    }

    // Parse nested PORTAL elements (from GetPortals)
    const portalPattern = /<PORTAL>([\s\S]*?)<\/PORTAL>/gi;
    const portals: Record<string, string>[] = [];
    let portalMatch;
    while ((portalMatch = portalPattern.exec(detailsXml)) !== null) {
      const portal: Record<string, string> = {};
      const innerPattern = /<([A-Z_]+)>([^<]*)<\/\1>/gi;
      let innerMatch;
      while ((innerMatch = innerPattern.exec(portalMatch[1])) !== null) {
        portal[innerMatch[1].toUpperCase()] = innerMatch[2].trim();
      }
      portals.push(portal);
    }
    if (portals.length > 0) {
      result['PORTALS'] = portals;
    }

    return result;
  }

  private mapPortalStatus(status: string): DoorStatus {
    const upper = (status || '').toUpperCase();
    if (upper === 'LOCKED' || upper === '0') return DoorStatus.LOCKED;
    if (upper === 'UNLOCKED' || upper === '1') return DoorStatus.UNLOCKED;
    if (upper === 'OPEN' || upper === '2') return DoorStatus.OPEN;
    if (upper === 'HELD' || upper === '3') return DoorStatus.HELD;
    if (upper === 'FORCED' || upper === '4') return DoorStatus.FORCED;
    return DoorStatus.UNKNOWN;
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
