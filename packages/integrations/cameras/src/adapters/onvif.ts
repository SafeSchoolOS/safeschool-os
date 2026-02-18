/**
 * ONVIF Camera Adapter
 *
 * Integrates with ONVIF-compliant IP cameras via:
 * - Device management (GetCapabilities, GetProfiles)
 * - RTSP stream URL construction
 * - Snapshot via GetSnapshotUri
 * - PTZ control via ONVIF PTZ service
 * - Motion detection via Pull-Point event subscription
 * - WS-Security UsernameToken authentication
 *
 * SOAP/XML messages are constructed inline to avoid heavy XML library deps.
 */

import crypto from 'node:crypto';
import type { Camera, CameraAdapter, CameraConfig, MotionEvent, PTZCommand, StreamInfo } from '../index.js';

// ---------------------------------------------------------------------------
// WS-Security UsernameToken helpers
// ---------------------------------------------------------------------------

function buildUsernameToken(username: string, password: string): string {
  const nonce = crypto.randomBytes(16);
  const created = new Date().toISOString();
  const digest = crypto
    .createHash('sha1')
    .update(Buffer.concat([nonce, Buffer.from(created, 'utf-8'), Buffer.from(password, 'utf-8')]))
    .digest('base64');

  return [
    '<Security xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"',
    '  s:mustUnderstand="true">',
    '  <UsernameToken>',
    `    <Username>${username}</Username>`,
    `    <Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</Password>`,
    `    <Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</Nonce>`,
    `    <Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${created}</Created>`,
    '  </UsernameToken>',
    '</Security>',
  ].join('\n');
}

function wrapSoap(body: string, securityHeader: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">',
    '  <s:Header>',
    `    ${securityHeader}`,
    '  </s:Header>',
    '  <s:Body>',
    `    ${body}`,
    '  </s:Body>',
    '</s:Envelope>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// ONVIF Adapter
// ---------------------------------------------------------------------------

export class OnvifAdapter implements CameraAdapter {
  name = 'ONVIF';

  private host: string;
  private port: number;
  private username: string;
  private password: string;
  private baseUrl: string;
  private connected = false;
  private profiles: Array<{ token: string; name: string }> = [];
  private motionCallbacks: ((event: MotionEvent) => void)[] = [];
  private pullPointUrl: string | null = null;
  private pullPointInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: CameraConfig) {
    this.host = config.host || 'localhost';
    this.port = config.port || 80;
    this.username = config.username || 'admin';
    this.password = config.password || '';
    this.baseUrl = `http://${this.host}:${this.port}`;
  }

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------

  async connect(): Promise<void> {
    // Fetch device capabilities to verify connectivity
    const capabilitiesBody = [
      '<GetCapabilities xmlns="http://www.onvif.org/ver10/device/wsdl">',
      '  <Category>All</Category>',
      '</GetCapabilities>',
    ].join('\n');

    const response = await this.soapRequest('/onvif/device_service', capabilitiesBody);
    if (!response.ok) {
      throw new Error(`ONVIF connect failed: HTTP ${response.status}`);
    }

    // Fetch media profiles
    await this.fetchProfiles();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.pullPointInterval) {
      clearInterval(this.pullPointInterval);
      this.pullPointInterval = null;
    }
    this.connected = false;
    this.profiles = [];
    this.pullPointUrl = null;
  }

  // -----------------------------------------------------------------------
  // Camera listing
  // -----------------------------------------------------------------------

  async getCameras(): Promise<Camera[]> {
    // For a single ONVIF camera, we return it as one "camera" per profile
    // In practice, each physical camera is one device.
    const deviceInfoBody = '<GetDeviceInformation xmlns="http://www.onvif.org/ver10/device/wsdl"/>';
    const response = await this.soapRequest('/onvif/device_service', deviceInfoBody);
    const xml = await response.text();

    const manufacturer = this.extractXmlValue(xml, 'Manufacturer') || 'Unknown';
    const model = this.extractXmlValue(xml, 'Model') || 'Unknown';

    return [
      {
        id: `${this.host}:${this.port}`,
        name: `${manufacturer} ${model}`,
        model,
        manufacturer,
        location: {
          description: `${this.host}:${this.port}`,
        },
        status: this.connected ? 'ONLINE' : 'OFFLINE',
        capabilities: {
          ptz: this.profiles.length > 0,
          audio: false,
          analytics: false,
          ir: false,
        },
      },
    ];
  }

  // -----------------------------------------------------------------------
  // Streaming
  // -----------------------------------------------------------------------

  async getStream(cameraId: string): Promise<StreamInfo> {
    const profileToken = this.profiles[0]?.token;
    if (!profileToken) throw new Error('No media profiles available');

    const body = [
      '<GetStreamUri xmlns="http://www.onvif.org/ver10/media/wsdl">',
      '  <StreamSetup>',
      '    <Stream xmlns="http://www.onvif.org/ver10/schema">RTP-Unicast</Stream>',
      '    <Transport xmlns="http://www.onvif.org/ver10/schema">',
      '      <Protocol>RTSP</Protocol>',
      '    </Transport>',
      '  </StreamSetup>',
      `  <ProfileToken>${profileToken}</ProfileToken>`,
      '</GetStreamUri>',
    ].join('\n');

    const response = await this.soapRequest('/onvif/media_service', body);
    const xml = await response.text();
    const uri = this.extractXmlValue(xml, 'Uri') || `rtsp://${this.host}:554/stream1`;

    // Inject credentials into RTSP URL for authenticated streams
    const rtspUrl = this.injectCredentials(uri);

    return { url: rtspUrl, protocol: 'rtsp' };
  }

  // -----------------------------------------------------------------------
  // Snapshot
  // -----------------------------------------------------------------------

  async getSnapshot(cameraId: string): Promise<Buffer> {
    const profileToken = this.profiles[0]?.token;
    if (!profileToken) throw new Error('No media profiles available');

    const body = [
      '<GetSnapshotUri xmlns="http://www.onvif.org/ver10/media/wsdl">',
      `  <ProfileToken>${profileToken}</ProfileToken>`,
      '</GetSnapshotUri>',
    ].join('\n');

    const response = await this.soapRequest('/onvif/media_service', body);
    const xml = await response.text();
    const snapshotUri = this.extractXmlValue(xml, 'Uri');

    if (!snapshotUri) {
      throw new Error('Camera did not return a snapshot URI');
    }

    // Fetch the actual snapshot image (Basic auth)
    const imgResponse = await fetch(snapshotUri, {
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${this.username}:${this.password}`).toString('base64'),
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!imgResponse.ok) {
      throw new Error(`Snapshot fetch failed: HTTP ${imgResponse.status}`);
    }

    const arrayBuf = await imgResponse.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  // -----------------------------------------------------------------------
  // PTZ Control
  // -----------------------------------------------------------------------

  async ptzControl(cameraId: string, command: PTZCommand): Promise<void> {
    const profileToken = this.profiles[0]?.token;
    if (!profileToken) throw new Error('No media profiles available');

    const pan = command.pan ?? 0;
    const tilt = command.tilt ?? 0;
    const zoom = command.zoom ?? 0;

    const body = [
      '<ContinuousMove xmlns="http://www.onvif.org/ver20/ptz/wsdl">',
      `  <ProfileToken>${profileToken}</ProfileToken>`,
      '  <Velocity>',
      `    <PanTilt x="${pan}" y="${tilt}" xmlns="http://www.onvif.org/ver10/schema"/>`,
      `    <Zoom x="${zoom}" xmlns="http://www.onvif.org/ver10/schema"/>`,
      '  </Velocity>',
      '</ContinuousMove>',
    ].join('\n');

    const response = await this.soapRequest('/onvif/ptz_service', body);
    if (!response.ok) {
      throw new Error(`PTZ control failed: HTTP ${response.status}`);
    }

    // Auto-stop after 500ms to prevent continuous motion
    if (pan !== 0 || tilt !== 0 || zoom !== 0) {
      setTimeout(() => this.ptzStop(profileToken).catch(() => {}), 500);
    }
  }

  // -----------------------------------------------------------------------
  // Motion Events (Pull-Point subscription)
  // -----------------------------------------------------------------------

  onMotionEvent(callback: (event: MotionEvent) => void): void {
    this.motionCallbacks.push(callback);

    // Start pull-point subscription if this is the first listener
    if (this.motionCallbacks.length === 1 && this.connected) {
      this.startPullPointSubscription().catch(() => {});
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async fetchProfiles(): Promise<void> {
    const body = '<GetProfiles xmlns="http://www.onvif.org/ver10/media/wsdl"/>';
    const response = await this.soapRequest('/onvif/media_service', body);
    const xml = await response.text();

    // Parse profile tokens (simplified regex extraction)
    const profileRegex = /<[\w:]*Profiles[^>]*token="([^"]+)"[^>]*>/g;
    let match: RegExpExecArray | null;
    this.profiles = [];
    while ((match = profileRegex.exec(xml)) !== null) {
      this.profiles.push({ token: match[1], name: match[1] });
    }

    // Fallback: if no profiles found try alternative pattern
    if (this.profiles.length === 0) {
      const altRegex = /<[\w:]*Profile[^>]*token="([^"]+)"[^>]*>/g;
      while ((match = altRegex.exec(xml)) !== null) {
        this.profiles.push({ token: match[1], name: match[1] });
      }
    }
  }

  private async ptzStop(profileToken: string): Promise<void> {
    const body = [
      '<Stop xmlns="http://www.onvif.org/ver20/ptz/wsdl">',
      `  <ProfileToken>${profileToken}</ProfileToken>`,
      '  <PanTilt>true</PanTilt>',
      '  <Zoom>true</Zoom>',
      '</Stop>',
    ].join('\n');

    await this.soapRequest('/onvif/ptz_service', body);
  }

  private async startPullPointSubscription(): Promise<void> {
    const body = [
      '<CreatePullPointSubscription xmlns="http://www.onvif.org/ver10/events/wsdl">',
      '  <Filter>',
      '    <TopicExpression xmlns="http://docs.oasis-open.org/wsn/b-2"',
      '      Dialect="http://www.onvif.org/ver10/tev/topicExpression/ConcreteSet">',
      '      tns1:RuleEngine/CellMotionDetector/Motion',
      '    </TopicExpression>',
      '  </Filter>',
      '  <InitialTerminationTime>PT60S</InitialTerminationTime>',
      '</CreatePullPointSubscription>',
    ].join('\n');

    try {
      const response = await this.soapRequest('/onvif/event_service', body);
      const xml = await response.text();

      // Extract the subscription reference address
      const addrMatch = xml.match(/<[\w:]*Address[^>]*>(http[^<]+)<\/[\w:]*Address>/);
      if (addrMatch) {
        this.pullPointUrl = addrMatch[1];
        this.pullPointInterval = setInterval(() => this.pullMessages(), 1000);
      }
    } catch {
      // Event service not available — silently ignore
    }
  }

  private async pullMessages(): Promise<void> {
    if (!this.pullPointUrl) return;

    const body = [
      '<PullMessages xmlns="http://www.onvif.org/ver10/events/wsdl">',
      '  <Timeout>PT1S</Timeout>',
      '  <MessageLimit>10</MessageLimit>',
      '</PullMessages>',
    ].join('\n');

    try {
      const secHeader = buildUsernameToken(this.username, this.password);
      const soapBody = wrapSoap(body, secHeader);

      const response = await fetch(this.pullPointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
        body: soapBody,
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) return;

      const xml = await response.text();

      // Check for motion events in the response
      if (xml.includes('Motion') && xml.includes('true')) {
        const event: MotionEvent = {
          cameraId: `${this.host}:${this.port}`,
          timestamp: new Date(),
          region: 'full-frame',
          confidence: 0.8,
        };
        this.motionCallbacks.forEach((cb) => cb(event));
      }
    } catch {
      // Pull failed — will retry on next interval
    }
  }

  private async soapRequest(path: string, body: string): Promise<Response> {
    const secHeader = buildUsernameToken(this.username, this.password);
    const soapBody = wrapSoap(body, secHeader);

    return fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
      },
      body: soapBody,
      signal: AbortSignal.timeout(10000),
    });
  }

  private extractXmlValue(xml: string, tagName: string): string | null {
    const regex = new RegExp(`<[\\w:]*${tagName}[^>]*>([^<]+)<\\/[\\w:]*${tagName}>`, 's');
    const match = xml.match(regex);
    return match ? match[1].trim() : null;
  }

  private injectCredentials(rtspUrl: string): string {
    try {
      const url = new URL(rtspUrl);
      url.username = this.username;
      url.password = this.password;
      return url.toString();
    } catch {
      // If URL parsing fails, construct manually
      return rtspUrl.replace('rtsp://', `rtsp://${this.username}:${this.password}@`);
    }
  }
}
