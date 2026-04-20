/**
 * Connector Registry
 *
 * Type registry + lifecycle management for connectors.
 * Ported from GSOC ConnectorRegistry (Python).
 */

import { ConnectorError, createLogger } from '@edgeruntime/core';
import { BaseConnector, type ConnectorConfig } from './base-connector.js';

const log = createLogger('connector-registry');

type ConnectorConstructor = new (name: string, config: ConnectorConfig) => BaseConnector;

export class ConnectorRegistry {
  private connectorTypes: Map<string, ConnectorConstructor> = new Map();
  private instances: Map<string, BaseConnector> = new Map();

  /**
   * Register a new connector type.
   */
  registerType(typeName: string, connectorClass: ConnectorConstructor): void {
    this.connectorTypes.set(typeName, connectorClass);
    log.info({ type: typeName }, 'Connector type registered');
  }

  /**
   * Create and register a connector instance.
   */
  createConnector(name: string, typeName: string, config: ConnectorConfig): BaseConnector {
    const ConnectorClass = this.connectorTypes.get(typeName);
    if (!ConnectorClass) {
      throw new ConnectorError(
        `Unknown connector type: ${typeName}. Available: ${this.getAvailableTypes().join(', ')}`,
        name,
      );
    }

    const instance = new ConnectorClass(name, config);
    this.instances.set(name, instance);
    log.info({ name, type: typeName }, 'Connector instance created');
    return instance;
  }

  /**
   * Get a connector instance by name.
   */
  getConnector(name: string): BaseConnector | undefined {
    return this.instances.get(name);
  }

  /**
   * Get all connector instances.
   */
  getAllConnectors(): BaseConnector[] {
    return Array.from(this.instances.values());
  }

  /**
   * Remove a connector instance.
   */
  async removeConnector(name: string): Promise<void> {
    const instance = this.instances.get(name);
    if (instance) {
      await instance.stopPolling();
      this.instances.delete(name);
      log.info({ name }, 'Connector removed');
    }
  }

  /**
   * Get list of available connector type names.
   */
  getAvailableTypes(): string[] {
    return Array.from(this.connectorTypes.keys());
  }

  /**
   * Start all connector instances.
   */
  async startAll(): Promise<void> {
    for (const [name, instance] of this.instances) {
      if (!instance.config.enabled) continue;
      try {
        await instance.startPolling();
        log.info({ name }, 'Connector started');
      } catch (err) {
        log.error({ err, name }, 'Connector failed to start');
      }
    }
  }

  /**
   * Stop all connector instances.
   */
  async stopAll(): Promise<void> {
    for (const [name, instance] of this.instances) {
      try {
        await instance.stopPolling();
        log.info({ name }, 'Connector stopped');
      } catch (err) {
        log.error({ err, name }, 'Connector failed to stop');
      }
    }
  }

  /**
   * Get status of all connectors.
   */
  getStatusAll(): Record<string, ReturnType<BaseConnector['getStatus']>> {
    const result: Record<string, ReturnType<BaseConnector['getStatus']>> = {};
    for (const [name, instance] of this.instances) {
      result[name] = instance.getStatus();
    }
    return result;
  }

  /**
   * Get capabilities of all connectors.
   */
  getCapabilitiesAll(): Record<string, ReturnType<BaseConnector['getCapabilities']>> {
    const result: Record<string, ReturnType<BaseConnector['getCapabilities']>> = {};
    for (const [name, instance] of this.instances) {
      result[name] = instance.getCapabilities();
    }
    return result;
  }

  /**
   * Execute a command on the appropriate connector(s).
   * Routes by connector type or name. Returns results per connector.
   */
  async executeCommand(
    command: string,
    payload: Record<string, unknown>,
    connectorName?: string,
  ): Promise<Record<string, { status: 'completed' | 'failed'; detail?: string }>> {
    const results: Record<string, { status: 'completed' | 'failed'; detail?: string }> = {};

    if (connectorName) {
      const instance = this.instances.get(connectorName);
      if (instance) {
        results[connectorName] = await instance.executeCommand(command, payload);
      } else {
        results[connectorName] = { status: 'failed', detail: `Connector ${connectorName} not found` };
      }
    } else {
      // Broadcast to all connectors that support this command
      for (const [name, instance] of this.instances) {
        const caps = instance.getCapabilities();
        if (caps.supportedCommands.includes(command)) {
          results[name] = await instance.executeCommand(command, payload);
        }
      }
    }
    return results;
  }
}
