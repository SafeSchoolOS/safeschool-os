import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OnvifAdapter } from '../adapters/onvif.js';
import type { CameraConfig, PTZCommand } from '../index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultConfig: CameraConfig = {
  type: 'onvif',
  host: '192.168.1.100',
  port: 80,
  username: 'admin',
  password: 'password123',
};

/**
 * Builds a fake SOAP response that wraps arbitrary body XML.
 */
function soapResponse(body: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">',
    '  <s:Body>',
    `    ${body}`,
    '  </s:Body>',
    '</s:Envelope>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OnvifAdapter', () => {
  let adapter: OnvifAdapter;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new OnvifAdapter(defaultConfig);

    // Mock global fetch
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('has the correct name', () => {
    expect(adapter.name).toBe('ONVIF');
  });

  it('connects successfully when device responds', async () => {
    // GetCapabilities response
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => soapResponse('<GetCapabilitiesResponse/>'),
    });

    // GetProfiles response
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        soapResponse('<Profiles token="profile_1" name="Main"><Name>MainStream</Name></Profiles>'),
    });

    await adapter.connect();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // First call should be to device_service (GetCapabilities)
    expect(fetchMock.mock.calls[0][0]).toContain('/onvif/device_service');
    // Second call should be to media_service (GetProfiles)
    expect(fetchMock.mock.calls[1][0]).toContain('/onvif/media_service');
  });

  it('throws on failed connection', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    await expect(adapter.connect()).rejects.toThrow('ONVIF connect failed: HTTP 401');
  });

  it('returns camera info from getCameras()', async () => {
    // Connect first
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => soapResponse('<GetCapabilitiesResponse/>'),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => soapResponse('<Profile token="prof1"/>'),
    });
    await adapter.connect();

    // GetDeviceInformation response
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        soapResponse(
          '<GetDeviceInformationResponse>' +
            '<Manufacturer>Axis</Manufacturer>' +
            '<Model>P3245-V</Model>' +
            '</GetDeviceInformationResponse>',
        ),
    });

    const cameras = await adapter.getCameras();

    expect(cameras).toHaveLength(1);
    expect(cameras[0].manufacturer).toBe('Axis');
    expect(cameras[0].model).toBe('P3245-V');
    expect(cameras[0].id).toBe('192.168.1.100:80');
    expect(cameras[0].status).toBe('ONLINE');
  });

  it('returns RTSP stream URL from getStream()', async () => {
    // Connect
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => soapResponse('<GetCapabilitiesResponse/>'),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => soapResponse('<Profile token="prof1"/>'),
    });
    await adapter.connect();

    // GetStreamUri response
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        soapResponse(
          '<GetStreamUriResponse>' +
            '<MediaUri><Uri>rtsp://192.168.1.100:554/stream1</Uri></MediaUri>' +
            '</GetStreamUriResponse>',
        ),
    });

    const stream = await adapter.getStream('192.168.1.100:80');

    expect(stream.protocol).toBe('rtsp');
    expect(stream.url).toContain('rtsp://');
    expect(stream.url).toContain('192.168.1.100');
  });

  it('sends PTZ commands', async () => {
    // Connect
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => soapResponse('<GetCapabilitiesResponse/>'),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => soapResponse('<Profile token="prof1"/>'),
    });
    await adapter.connect();

    // PTZ ContinuousMove response
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => soapResponse('<ContinuousMoveResponse/>'),
    });

    // PTZ Stop response (auto-stop after 500ms)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => soapResponse('<StopResponse/>'),
    });

    const command: PTZCommand = { pan: 0.5, tilt: -0.3, zoom: 0 };
    await adapter.ptzControl('192.168.1.100:80', command);

    // ContinuousMove call should target the PTZ service
    const ptzCall = fetchMock.mock.calls[2];
    expect(ptzCall[0]).toContain('/onvif/ptz_service');
    expect(ptzCall[1].body).toContain('0.5');
    expect(ptzCall[1].body).toContain('-0.3');
  });

  it('registers motion event callbacks', () => {
    const callback = vi.fn();
    adapter.onMotionEvent(callback);

    // Callback registered — doesn't start pulling until connected
    expect(callback).not.toHaveBeenCalled();
  });

  it('disconnects cleanly', async () => {
    // Connect
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => soapResponse('<GetCapabilitiesResponse/>'),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => soapResponse('<Profile token="prof1"/>'),
    });
    await adapter.connect();

    await adapter.disconnect();

    // After disconnect, getCameras should show OFFLINE
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        soapResponse(
          '<GetDeviceInformationResponse>' +
            '<Manufacturer>Test</Manufacturer>' +
            '<Model>Test</Model>' +
            '</GetDeviceInformationResponse>',
        ),
    });

    const cameras = await adapter.getCameras();
    expect(cameras[0].status).toBe('OFFLINE');
  });
});
