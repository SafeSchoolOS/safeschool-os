import type { DispatchAdapter, DispatchPayload, DispatchResult } from '../index.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CellularFailoverConfig {
  /** Serial port device path (e.g. COM3, /dev/ttyUSB0) */
  devicePath: string;
  /** Baud rate (default 9600) */
  baudRate?: number;
  /** Destination number — the 911 SMS gateway or Text-to-911 endpoint */
  destinationNumber?: string;
  /** Command timeout in ms (default 5000) */
  commandTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Serial port abstraction (allows injection for testing)
// ---------------------------------------------------------------------------

export interface SerialPortInterface {
  open(devicePath: string, baudRate: number): Promise<void>;
  write(data: string): Promise<void>;
  read(timeoutMs: number): Promise<string>;
  close(): Promise<void>;
}

/**
 * Default serial port implementation using Node.js.
 * In production this would wrap the `serialport` npm package.
 * Provided as a reference — tests inject a mock.
 */
export class NodeSerialPort implements SerialPortInterface {
  private port: any = null;

  async open(devicePath: string, baudRate: number): Promise<void> {
    // Dynamic import so the module is optional (only needed on edge)
    try {
      const { SerialPort } = await import('serialport' as any);
      this.port = new SerialPort({ path: devicePath, baudRate });
      await new Promise<void>((resolve, reject) => {
        this.port.on('open', () => resolve());
        this.port.on('error', (err: Error) => reject(err));
      });
    } catch (err) {
      throw new Error(
        `Failed to open serial port ${devicePath}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async write(data: string): Promise<void> {
    if (!this.port) throw new Error('Serial port not open');
    await new Promise<void>((resolve, reject) => {
      this.port.write(data, (err: Error | null) => {
        if (err) reject(err);
        else this.port.drain(() => resolve());
      });
    });
  }

  async read(timeoutMs: number): Promise<string> {
    if (!this.port) throw new Error('Serial port not open');
    return new Promise<string>((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => {
        reject(new Error('Serial read timed out'));
      }, timeoutMs);

      const onData = (data: Buffer) => {
        buffer += data.toString('utf-8');
        // AT command responses end with OK, ERROR, or +CMS ERROR
        if (
          buffer.includes('OK') ||
          buffer.includes('ERROR') ||
          buffer.includes('+CMS ERROR')
        ) {
          clearTimeout(timer);
          this.port.removeListener('data', onData);
          resolve(buffer.trim());
        }
      };

      this.port.on('data', onData);
    });
  }

  async close(): Promise<void> {
    if (!this.port) return;
    await new Promise<void>((resolve) => {
      this.port.close(() => resolve());
    });
    this.port = null;
  }
}

// ---------------------------------------------------------------------------
// AT command helpers
// ---------------------------------------------------------------------------

/** Format a message for SMS via AT commands. */
function formatSmsMessage(alert: DispatchPayload): string {
  const parts = [
    `911 EMERGENCY - SafeSchool Alert`,
    `Type: ${alert.level}`,
    `Location: ${alert.buildingName}`,
  ];

  if (alert.roomName) parts.push(`Room: ${alert.roomName}`);
  if (alert.floor !== undefined) parts.push(`Floor: ${alert.floor}`);
  if (alert.latitude && alert.longitude) {
    parts.push(`GPS: ${alert.latitude},${alert.longitude}`);
  }
  if (alert.callerInfo) parts.push(`Caller: ${alert.callerInfo}`);
  parts.push(`AlertID: ${alert.alertId}`);

  return parts.join('\n');
}

/** Parse AT command response to determine success. */
function parseAtResponse(response: string): {
  success: boolean;
  messageRef?: string;
  error?: string;
} {
  if (response.includes('+CMGS:')) {
    // +CMGS: <mr> means message was sent
    const match = response.match(/\+CMGS:\s*(\d+)/);
    return {
      success: true,
      messageRef: match ? match[1] : undefined,
    };
  }

  if (response.includes('+CMS ERROR')) {
    const match = response.match(/\+CMS ERROR:\s*(.+)/);
    return {
      success: false,
      error: `CMS Error: ${match ? match[1].trim() : 'unknown'}`,
    };
  }

  if (response.includes('ERROR')) {
    return { success: false, error: 'AT command error' };
  }

  if (response.includes('OK')) {
    return { success: true };
  }

  return { success: false, error: `Unexpected response: ${response}` };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Cellular Failover Dispatch Adapter
 *
 * Last-resort 911 dispatch using a USB cellular modem.
 * Sends an SMS to the Text-to-911 gateway via AT commands.
 * This adapter is designed for edge deployments where network
 * connectivity may be completely lost.
 */
export class CellularFailoverAdapter implements DispatchAdapter {
  name = 'Cellular Failover';

  private config: CellularFailoverConfig;
  private serialFactory: () => SerialPortInterface;

  constructor(
    config: CellularFailoverConfig,
    serialFactory?: () => SerialPortInterface,
  ) {
    this.config = {
      baudRate: 9600,
      destinationNumber: '911',
      commandTimeoutMs: 5_000,
      ...config,
    };
    this.serialFactory = serialFactory ?? (() => new NodeSerialPort());
  }

  // -----------------------------------------------------------------------
  // DispatchAdapter interface
  // -----------------------------------------------------------------------

  async dispatch(alert: DispatchPayload): Promise<DispatchResult> {
    const start = Date.now();
    let serial: SerialPortInterface | null = null;

    try {
      serial = this.serialFactory();
      await serial.open(this.config.devicePath, this.config.baudRate!);

      // Initialize modem
      await this.sendCommand(serial, 'ATE0\r'); // Disable echo
      await this.sendCommand(serial, 'AT+CMGF=1\r'); // Set text mode

      // Compose SMS
      const message = formatSmsMessage(alert);
      const destination = this.config.destinationNumber!;

      // Send SMS via AT+CMGS
      await serial.write(`AT+CMGS="${destination}"\r`);
      // Small delay for modem to be ready for message body
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Write message body and terminate with Ctrl+Z (0x1A)
      await serial.write(message + '\x1A');

      // Read response (may take several seconds for cellular)
      const response = await serial.read(this.config.commandTimeoutMs! * 3);
      const parsed = parseAtResponse(response);

      const dispatchId = parsed.messageRef
        ? `cellular-${parsed.messageRef}`
        : `cellular-${Date.now()}`;

      return {
        success: parsed.success,
        dispatchId,
        method: 'CELLULAR',
        responseTimeMs: Date.now() - start,
        error: parsed.error,
      };
    } catch (err) {
      return {
        success: false,
        dispatchId: '',
        method: 'CELLULAR',
        responseTimeMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (serial) {
        await serial.close().catch(() => {});
      }
    }
  }

  async getStatus(_dispatchId: string): Promise<string> {
    // SMS-based dispatch is fire-and-forget. No status tracking available.
    return 'SENT';
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private async sendCommand(
    serial: SerialPortInterface,
    command: string,
  ): Promise<string> {
    await serial.write(command);
    const response = await serial.read(this.config.commandTimeoutMs!);
    const parsed = parseAtResponse(response);
    if (!parsed.success && !response.includes('OK')) {
      throw new Error(`AT command failed: ${command.trim()} -> ${response}`);
    }
    return response;
  }
}
