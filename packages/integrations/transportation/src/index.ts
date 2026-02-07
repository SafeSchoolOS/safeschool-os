/**
 * Student Transportation & Tracking Module
 *
 * Handles bus GPS tracking, student RFID ridership scanning,
 * and automated parent notifications for student transport status.
 *
 * Notification Flow:
 *   Student scans RFID on bus reader
 *     → System records boarding event
 *     → Parent receives SMS/email/push: "Alex boarded Bus #42 at Oak St stop at 7:15 AM"
 *
 *   Bus approaches school
 *     → Geofence triggers arrival notification
 *     → Parent receives: "Bus #42 arriving at Lincoln Elementary, ETA 2 min"
 *
 *   Student exits bus at school
 *     → System records exit + marks attendance
 *     → Parent receives: "Alex arrived at Lincoln Elementary at 7:45 AM"
 *
 *   Bus running late
 *     → System detects delay beyond threshold
 *     → Parent receives: "Bus #42 is running ~10 min late. New ETA: 7:55 AM"
 *
 *   Student doesn't scan expected bus
 *     → After departure + grace period
 *     → Parent receives: "Alex did not board Bus #42 this morning"
 */

import type {
  Bus,
  BusRoute,
  BusStop,
  GpsPosition,
  ParentContact,
  StudentRidership,
  TransportNotification,
  TransportNotificationType,
} from '@safeschool/core';

export interface TransportConfig {
  siteId: string;
  geofenceRadiusMeters: number;       // Default: 200m for "approaching" alerts
  delayThresholdMinutes: number;       // Default: 5 min before delay alert
  missedBusGraceMinutes: number;       // Default: 10 min after departure
  notificationChannels: ('SMS' | 'EMAIL' | 'PUSH')[];
}

export class StudentTransportService {
  private config: TransportConfig;

  constructor(config: TransportConfig) {
    this.config = config;
  }

  /**
   * Process an RFID scan event from a bus reader.
   * This is the core event that triggers the notification chain.
   */
  async processRfidScan(scan: {
    cardId: string;
    busId: string;
    scanType: 'BOARD' | 'EXIT';
    timestamp: Date;
  }): Promise<StudentRidership> {
    // TODO: Look up student by RFID card ID
    // TODO: Record ridership event in database
    // TODO: Trigger parent notification
    // TODO: If EXIT at school, update attendance in SIS

    const ridership: StudentRidership = {
      id: crypto.randomUUID(),
      studentId: '', // Resolved from cardId lookup
      studentName: '',
      busId: scan.busId,
      routeId: '',
      stopId: '',
      scanType: scan.scanType,
      scannedAt: scan.timestamp,
      scanMethod: 'RFID',
      cardId: scan.cardId,
    };

    // Determine notification type based on scan
    const notificationType: TransportNotificationType =
      scan.scanType === 'BOARD'
        ? 'STUDENT_BOARDED'
        : 'STUDENT_EXITED';

    await this.sendParentNotification(ridership, notificationType);

    return ridership;
  }

  /**
   * Process GPS update from a bus.
   * Checks geofences for approaching-stop and arrival notifications.
   */
  async processGpsUpdate(busId: string, position: GpsPosition): Promise<void> {
    // TODO: Update bus position in database
    // TODO: Check if bus is within geofence of any stops
    // TODO: Check if bus is approaching school (arrival geofence)
    // TODO: Check if bus is running late vs schedule
    // TODO: Trigger appropriate notifications
  }

  /**
   * Check for missed bus events.
   * Called periodically after scheduled departure times.
   */
  async checkMissedBus(routeId: string): Promise<void> {
    // TODO: Get route schedule and assigned students
    // TODO: Compare against actual scans
    // TODO: Students assigned but not scanned = missed bus
    // TODO: Send MISSED_BUS notification to parents
  }

  /**
   * Calculate ETA to a stop based on current position and route.
   */
  calculateEta(currentPosition: GpsPosition, targetStop: BusStop, route: BusRoute): number {
    // Simple distance-based ETA calculation
    // TODO: Use actual route geometry and traffic data for better estimates
    const distanceKm = this.haversineDistance(
      currentPosition.latitude,
      currentPosition.longitude,
      targetStop.location.latitude,
      targetStop.location.longitude,
    );

    const avgSpeedKmh = (currentPosition.speed || 25) * 1.60934; // mph to km/h
    return Math.round((distanceKm / avgSpeedKmh) * 60); // minutes
  }

  /**
   * Send notification to parent(s) about their student's transport status.
   */
  private async sendParentNotification(
    ridership: StudentRidership,
    type: TransportNotificationType,
  ): Promise<TransportNotification> {
    // TODO: Look up parent contacts for this student
    // TODO: Build message based on notification type
    // TODO: Send via configured channels (SMS, email, push)
    // TODO: Record notification in database

    const messages: Record<TransportNotificationType, string> = {
      STUDENT_BOARDED: `${ridership.studentName} boarded Bus #${ridership.busId} at ${new Date(ridership.scannedAt).toLocaleTimeString()}`,
      STUDENT_EXITED: `${ridership.studentName} exited Bus #${ridership.busId} at ${new Date(ridership.scannedAt).toLocaleTimeString()}`,
      BUS_APPROACHING_STOP: `Bus #${ridership.busId} is approaching your stop. ETA: 2 minutes`,
      BUS_ARRIVED_AT_SCHOOL: `Bus #${ridership.busId} has arrived at school`,
      BUS_DEPARTED_SCHOOL: `Bus #${ridership.busId} has departed school`,
      BUS_DELAY: `Bus #${ridership.busId} is running late`,
      MISSED_BUS: `${ridership.studentName} did not board Bus #${ridership.busId} this morning`,
      ROUTE_DEVIATION: `Bus #${ridership.busId} has deviated from its scheduled route`,
      DRIVER_PANIC: `EMERGENCY: Alert triggered on Bus #${ridership.busId}`,
    };

    const notification: TransportNotification = {
      id: crypto.randomUUID(),
      type,
      studentId: ridership.studentId,
      parentContactIds: [], // Resolved from student lookup
      busId: ridership.busId,
      routeId: ridership.routeId,
      message: messages[type],
      sentVia: this.config.notificationChannels,
      sentAt: new Date(),
      metadata: {
        busNumber: ridership.busId,
      },
    };

    return notification;
  }

  /**
   * Haversine formula for distance between two GPS coordinates.
   */
  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}
