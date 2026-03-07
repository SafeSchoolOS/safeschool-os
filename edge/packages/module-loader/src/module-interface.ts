/**
 * IEdgeModule - contract that all product modules must implement.
 *
 * Each module (safeschool)
 * implements this interface to plug into the EdgeRuntime.
 */

import type { ModuleManifest } from '@edgeruntime/core';

export interface IEdgeModule {
  /**
   * Return the module manifest describing its identity, entity types,
   * and conflict resolution strategies.
   */
  getManifest(): ModuleManifest;

  /**
   * Initialize the module. Called once during runtime boot after activation
   * key validation. Receives runtime context for registering connectors,
   * conflict strategies, etc.
   */
  initialize(context: ModuleContext): Promise<void>;

  /**
   * Start the module's runtime operations (polling, event handling, etc.).
   */
  start(): Promise<void>;

  /**
   * Stop the module gracefully.
   */
  stop(): Promise<void>;

  /**
   * Health check for this module.
   */
  healthCheck(): Promise<ModuleHealthStatus>;
}

export interface ModuleContext {
  siteId: string;
  dataDir: string;
  registerConflictStrategy: (entityType: string, strategy: string) => void;
  registerConflictMerger: (entityType: string, merger: (local: any, remote: any) => any) => void;
  registerConnectorType: (typeName: string, connectorClass: any) => void;
  trackChange: (entity: { type: string; action: 'create' | 'update' | 'delete'; data: Record<string, unknown>; timestamp: string }) => void;
  /** Register a handler for inbound federated events from other products. Returns analytics entities to push back. */
  registerFederationHandler?: (handler: (fromProduct: string, events: Record<string, unknown>[]) => Record<string, unknown>[]) => void;
  /** User account store synced from cloud. Available for auth checks in product modules. */
  userAccountStore?: {
    getByUsername(username: string): Promise<any>;
    getByEmail(email: string): Promise<any>;
    getAll(): Promise<any[]>;
    verifyPassword(username: string, password: string): Promise<boolean>;
  };
}

export interface ModuleHealthStatus {
  healthy: boolean;
  details?: Record<string, unknown>;
}
