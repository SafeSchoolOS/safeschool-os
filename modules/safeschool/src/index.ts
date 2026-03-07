/**
 * SafeSchool Module
 *
 * Campus safety and school security module providing:
 * - Visitor management (check-in/out, screening, badge printing)
 * - Emergency lockdown coordination
 * - Bus tracking and parent notifications
 * - Student/staff roster sync
 * - Incident management and escalation
 * - Integration with school SIS (Student Information Systems)
 *
 * This module runs on the Ubuntu full appliance alongside the
 * SafeSchool API, dashboard, and kiosk containers.
 *
 * Uses @safeschoolos/adapters for all vendor integrations.
 */

import type { ModuleManifest } from '@edgeruntime/core';
import { createLogger } from '@edgeruntime/core';
import type { IEdgeModule, ModuleContext, ModuleHealthStatus } from '@edgeruntime/module-loader';
import { ConnectorRegistry } from '@edgeruntime/connector-framework';
import { createAdapter as createAccessAdapter } from '@safeschoolos/adapters/access-control';
import type { AccessControlAdapter } from '@safeschoolos/adapters/access-control';
import { createCameraAdapter } from '@safeschoolos/adapters/cameras';
import type { CameraAdapter, CameraConfig } from '@safeschoolos/adapters/cameras';
import { createDispatchAdapter, DispatchChain } from '@safeschoolos/adapters/dispatch';
import type { DispatchAdapter } from '@safeschoolos/adapters/dispatch';
import { NotificationRouter } from '@safeschoolos/adapters/notifications';
import { createBadgePrinter } from '@safeschoolos/adapters/badge-printing';
import type { BadgePrinterAdapter } from '@safeschoolos/adapters/badge-printing';
import { VisitorService, ConsoleScreeningAdapter } from '@safeschoolos/adapters/visitor-mgmt';
import { NWSAdapter } from '@safeschoolos/adapters/weather';
import type { WeatherAdapter } from '@safeschoolos/adapters/weather';
import { LenelOnGuardConnector } from './connectors/lenel-onguard.js';
import { MilestoneXProtectConnector } from './connectors/milestone-xprotect.js';
import { FireAlarmConnector } from './connectors/fire-alarm.js';
import { IntrusionPanelConnector } from './connectors/intrusion-panel.js';
import { IntercomConnector } from './connectors/intercom.js';

export class SafeSchoolModule implements IEdgeModule {
  private context: ModuleContext | null = null;
  private started = false;
  private readonly log = createLogger('module:safeschool');
  private connectorRegistry = new ConnectorRegistry();

  private accessAdapter: AccessControlAdapter | null = null;
  private cameraAdapter: CameraAdapter | null = null;
  private dispatchAdapter: DispatchAdapter | null = null;
  private dispatchChain: DispatchChain | null = null;
  private notificationRouter: NotificationRouter | null = null;
  private badgePrinter: BadgePrinterAdapter | null = null;
  private visitorService: VisitorService | null = null;
  private weatherAdapter: WeatherAdapter | null = null;

  getManifest(): ModuleManifest {
    return {
      name: 'safeschool',
      version: '0.1.0',
      product: 'safeschool',
      description: 'Campus safety: visitors, lockdowns, bus tracking, incidents',
      entityTypes: [
        // Visitor management
        'visitor', 'visitor_check_in', 'visitor_check_out', 'visitor_screening',
        // Emergency
        'lockdown', 'lockdown_zone', 'emergency_alert',
        // Transportation
        'bus_route', 'bus_position', 'bus_stop_event', 'parent_notification',
        // Roster
        'student', 'staff', 'guardian',
        // Incidents
        'incident', 'incident_update', 'audit_log',
        // Scheduling
        'bell_schedule', 'school_day',
      ],
      conflictStrategies: {
        // Visitor events are created on edge, edge wins
        visitor: 'edge-wins',
        visitor_check_in: 'edge-wins',
        visitor_check_out: 'edge-wins',
        visitor_screening: 'edge-wins',
        // Lockdowns: cloud-wins for coordinated multi-site lockdowns
        lockdown: 'cloud-wins',
        lockdown_zone: 'cloud-wins',
        emergency_alert: 'cloud-wins',
        // Transportation: last-write-wins for real-time GPS
        bus_route: 'cloud-wins',
        bus_position: 'last-write-wins',
        bus_stop_event: 'edge-wins',
        parent_notification: 'edge-wins',
        // Roster: cloud is source of truth (synced from SIS)
        student: 'cloud-wins',
        staff: 'cloud-wins',
        guardian: 'cloud-wins',
        // Incidents: cloud-wins for coordinated response
        incident: 'cloud-wins',
        incident_update: 'cloud-wins',
        audit_log: 'edge-wins',
        // Scheduling: cloud is source of truth
        bell_schedule: 'cloud-wins',
        school_day: 'cloud-wins',
      },
    };
  }

  async initialize(context: ModuleContext): Promise<void> {
    this.context = context;

    // Register connector types (for consistent PAC integration
    context.registerConnectorType('lenel-onguard', LenelOnGuardConnector as any);
    context.registerConnectorType('milestone-xprotect', MilestoneXProtectConnector as any);
    context.registerConnectorType('fire-alarm', FireAlarmConnector as any);
    context.registerConnectorType('intrusion-panel', IntrusionPanelConnector as any);
    context.registerConnectorType('intercom', IntercomConnector as any);

    this.log.info('SafeSchool module initialized');
  }

  async start(): Promise<void> {
    // Access control
    const acVendor = process.env.ACCESS_CONTROL_VENDOR;
    if (acVendor) {
      try {
        this.accessAdapter = createAccessAdapter(acVendor);
        this.log.info({ vendor: acVendor }, 'Access control adapter initialized');
      } catch (err) {
        this.log.warn({ vendor: acVendor, err }, 'Failed to create access control adapter');
      }
    }

    // Cameras
    const camVendor = process.env.CAMERA_VENDOR;
    if (camVendor) {
      try {
        const camConfig: CameraConfig = {
          type: camVendor,
          host: process.env.CAMERA_HOST ?? '',
          port: Number(process.env.CAMERA_PORT ?? '80'),
          username: process.env.CAMERA_USERNAME ?? '',
          password: process.env.CAMERA_PASSWORD ?? '',
        };
        this.cameraAdapter = createCameraAdapter(camVendor, camConfig);
        this.log.info({ vendor: camVendor }, 'Camera adapter initialized');
      } catch (err) {
        this.log.warn({ vendor: camVendor, err }, 'Failed to create camera adapter');
      }
    }

    // Dispatch (911/emergency)
    const dispatchType = process.env.DISPATCH_ADAPTER;
    if (dispatchType) {
      try {
        this.dispatchAdapter = createDispatchAdapter(dispatchType);
        this.log.info({ type: dispatchType }, 'Dispatch adapter initialized');
      } catch (err) {
        this.log.warn({ type: dispatchType, err }, 'Failed to create dispatch adapter');
      }
    }

    // Notification router
    this.notificationRouter = new NotificationRouter();

    // Badge printer
    this.badgePrinter = createBadgePrinter();
    if (this.badgePrinter) {
      this.log.info('Badge printer adapter initialized');
    }

    // Visitor screening adapter (VisitorService requires a DatabaseClient
    // for persistence — injected by the runtime when a DB is available)
    const screeningAdapter = new ConsoleScreeningAdapter();
    this.log.info('Visitor screening adapter initialized');

    // Weather
    this.weatherAdapter = new NWSAdapter();

    this.started = true;
    this.log.info('SafeSchool module started');
  }

  async stop(): Promise<void> {
    await this.connectorRegistry.stopAll();
    this.accessAdapter = null;
    this.cameraAdapter = null;
    this.dispatchAdapter = null;
    this.dispatchChain = null;
    this.notificationRouter = null;
    this.badgePrinter = null;
    this.visitorService = null;
    this.weatherAdapter = null;
    this.started = false;
    this.log.info('SafeSchool module stopped');
  }

  async healthCheck(): Promise<ModuleHealthStatus> {
    const connectorStatuses = this.connectorRegistry.getStatusAll();
    const connectorCount = Object.keys(connectorStatuses).length;
    const connectedCount = Object.values(connectorStatuses).filter(s => s.connected).length;

    return {
      healthy: this.started,
      details: {
        initialized: this.context !== null,
        started: this.started,
        accessAdapter: this.accessAdapter !== null,
        cameraAdapter: this.cameraAdapter !== null,
        dispatchAdapter: this.dispatchAdapter !== null,
        notificationRouter: this.notificationRouter !== null,
        badgePrinter: this.badgePrinter !== null,
        visitorService: this.visitorService !== null,
        weatherAdapter: this.weatherAdapter !== null,
        connectorInstances: connectorCount,
        connectedInstances: connectedCount,
        connectors: connectorStatuses,
      },
    };
  }

  getAccessAdapter(): AccessControlAdapter | null { return this.accessAdapter; }
  getCameraAdapter(): CameraAdapter | null { return this.cameraAdapter; }
  getDispatchAdapter(): DispatchAdapter | null { return this.dispatchAdapter; }
  getNotificationRouter(): NotificationRouter | null { return this.notificationRouter; }
  getVisitorService(): VisitorService | null { return this.visitorService; }
  getWeatherAdapter(): WeatherAdapter | null { return this.weatherAdapter; }
  getConnectorRegistry(): ConnectorRegistry { return this.connectorRegistry; }
}

export default SafeSchoolModule;
