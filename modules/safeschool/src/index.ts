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
 * Vendor adapters are loaded dynamically from @safeschoolos/adapters.
 * If the package is not installed, the module runs without vendor
 * integrations (built-in connectors still work).
 */

import type { ModuleManifest } from '@edgeruntime/core';
import { createLogger } from '@edgeruntime/core';
import type { IEdgeModule, ModuleContext, ModuleHealthStatus } from '@edgeruntime/module-loader';
import { ConnectorRegistry } from '@edgeruntime/connector-framework';
import { LenelOnGuardConnector } from './connectors/lenel-onguard.js';
import { MilestoneXProtectConnector } from './connectors/milestone-xprotect.js';
import { FireAlarmConnector } from './connectors/fire-alarm.js';
import { IntrusionPanelConnector } from './connectors/intrusion-panel.js';
import { IntercomConnector } from './connectors/intercom.js';

const log = createLogger('module:safeschool');

// Adapter types - kept as `any` when the package is not installed
type AdapterRef = any;

// Dynamic adapter loader - returns null if @safeschoolos/adapters is not installed
async function tryLoadAdapters() {
  try {
    const [ac, cam, dispatch, notif, badge, visitor, weather] = await Promise.all([
      import('@safeschoolos/adapters/access-control'),
      import('@safeschoolos/adapters/cameras'),
      import('@safeschoolos/adapters/dispatch'),
      import('@safeschoolos/adapters/notifications'),
      import('@safeschoolos/adapters/badge-printing'),
      import('@safeschoolos/adapters/visitor-mgmt'),
      import('@safeschoolos/adapters/weather'),
    ]);
    log.info('Vendor adapters loaded from @safeschoolos/adapters');
    return { ac, cam, dispatch, notif, badge, visitor, weather };
  } catch {
    log.info('Running without @safeschoolos/adapters - vendor integrations disabled. Install the package to enable them.');
    return null;
  }
}

export class SafeSchoolModule implements IEdgeModule {
  private context: ModuleContext | null = null;
  private started = false;
  private connectorRegistry = new ConnectorRegistry();

  private accessAdapter: AdapterRef = null;
  private cameraAdapter: AdapterRef = null;
  private dispatchAdapter: AdapterRef = null;
  private dispatchChain: AdapterRef = null;
  private notificationRouter: AdapterRef = null;
  private badgePrinter: AdapterRef = null;
  private visitorService: AdapterRef = null;
  private weatherAdapter: AdapterRef = null;

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
        visitor: 'edge-wins',
        visitor_check_in: 'edge-wins',
        visitor_check_out: 'edge-wins',
        visitor_screening: 'edge-wins',
        lockdown: 'cloud-wins',
        lockdown_zone: 'cloud-wins',
        emergency_alert: 'cloud-wins',
        bus_route: 'cloud-wins',
        bus_position: 'last-write-wins',
        bus_stop_event: 'edge-wins',
        parent_notification: 'edge-wins',
        student: 'cloud-wins',
        staff: 'cloud-wins',
        guardian: 'cloud-wins',
        incident: 'cloud-wins',
        incident_update: 'cloud-wins',
        audit_log: 'edge-wins',
        bell_schedule: 'cloud-wins',
        school_day: 'cloud-wins',
      },
    };
  }

  async initialize(context: ModuleContext): Promise<void> {
    this.context = context;

    // Register connector types (for consistent PAC integration)
    context.registerConnectorType('lenel-onguard', LenelOnGuardConnector as any);
    context.registerConnectorType('milestone-xprotect', MilestoneXProtectConnector as any);
    context.registerConnectorType('fire-alarm', FireAlarmConnector as any);
    context.registerConnectorType('intrusion-panel', IntrusionPanelConnector as any);
    context.registerConnectorType('intercom', IntercomConnector as any);

    log.info('SafeSchool module initialized');
  }

  async start(): Promise<void> {
    const adapters = await tryLoadAdapters();

    if (adapters) {
      // Access control
      const acVendor = process.env.ACCESS_CONTROL_VENDOR;
      if (acVendor) {
        try {
          this.accessAdapter = adapters.ac.createAdapter(acVendor);
          log.info({ vendor: acVendor }, 'Access control adapter initialized');
        } catch (err) {
          log.warn({ vendor: acVendor, err }, 'Failed to create access control adapter');
        }
      }

      // Cameras
      const camVendor = process.env.CAMERA_VENDOR;
      if (camVendor) {
        try {
          this.cameraAdapter = adapters.cam.createCameraAdapter(camVendor, {
            type: camVendor,
            host: process.env.CAMERA_HOST ?? '',
            port: Number(process.env.CAMERA_PORT ?? '80'),
            username: process.env.CAMERA_USERNAME ?? '',
            password: process.env.CAMERA_PASSWORD ?? '',
          });
          log.info({ vendor: camVendor }, 'Camera adapter initialized');
        } catch (err) {
          log.warn({ vendor: camVendor, err }, 'Failed to create camera adapter');
        }
      }

      // Dispatch (911/emergency)
      const dispatchType = process.env.DISPATCH_ADAPTER;
      if (dispatchType) {
        try {
          this.dispatchAdapter = adapters.dispatch.createDispatchAdapter(dispatchType);
          log.info({ type: dispatchType }, 'Dispatch adapter initialized');
        } catch (err) {
          log.warn({ type: dispatchType, err }, 'Failed to create dispatch adapter');
        }
      }

      // Notification router
      this.notificationRouter = new adapters.notif.NotificationRouter();

      // Badge printer
      this.badgePrinter = adapters.badge.createBadgePrinter();
      if (this.badgePrinter) {
        log.info('Badge printer adapter initialized');
      }

      // Visitor screening
      new adapters.visitor.ConsoleScreeningAdapter();
      log.info('Visitor screening adapter initialized');

      // Weather
      this.weatherAdapter = new adapters.weather.NWSAdapter();
    }

    this.started = true;
    log.info('SafeSchool module started');
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
    log.info('SafeSchool module stopped');
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

  getAccessAdapter(): AdapterRef { return this.accessAdapter; }
  getCameraAdapter(): AdapterRef { return this.cameraAdapter; }
  getDispatchAdapter(): AdapterRef { return this.dispatchAdapter; }
  getNotificationRouter(): AdapterRef { return this.notificationRouter; }
  getVisitorService(): AdapterRef { return this.visitorService; }
  getWeatherAdapter(): AdapterRef { return this.weatherAdapter; }
  getConnectorRegistry(): ConnectorRegistry { return this.connectorRegistry; }
}

export default SafeSchoolModule;
