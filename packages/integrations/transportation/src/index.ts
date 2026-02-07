/**
 * Student Transportation & Tracking Module
 *
 * Handles bus GPS tracking, student RFID ridership scanning,
 * and automated parent notifications for student transport status.
 */

import type { PrismaClient } from '@safeschool/db';
import {
  TransportNotificationType,
} from '@safeschool/core';
import type {
  Bus,
  BusRoute,
  BusStop,
  GpsPosition,
  StudentRidership,
  TransportNotification,
} from '@safeschool/core';
import type { NotificationRouter } from '@safeschool/notifications';

export interface TransportConfig {
  siteId: string;
  geofenceRadiusMeters: number;
  delayThresholdMinutes: number;
  missedBusGraceMinutes: number;
  notificationChannels: ('SMS' | 'EMAIL' | 'PUSH')[];
}

export class StudentTransportService {
  private config: TransportConfig;
  private prisma: PrismaClient;
  private notificationRouter?: NotificationRouter;

  constructor(config: TransportConfig, prisma: PrismaClient, notificationRouter?: NotificationRouter) {
    this.config = config;
    this.prisma = prisma;
    this.notificationRouter = notificationRouter;
  }

  /**
   * Process an RFID scan event from a bus reader.
   */
  async processRfidScan(scan: {
    cardId: string;
    busId: string;
    scanType: 'BOARD' | 'EXIT';
    timestamp: Date;
  }): Promise<StudentRidership> {
    // Look up student by RFID card ID
    const studentCard = await this.prisma.studentCard.findUnique({
      where: { cardId: scan.cardId },
      include: { parentContacts: true },
    });

    if (!studentCard) {
      throw new Error(`Unknown RFID card: ${scan.cardId}`);
    }

    // Get bus with route
    const bus = await this.prisma.bus.findUnique({
      where: { id: scan.busId },
      include: { routeAssignments: true },
    });

    if (!bus) throw new Error(`Bus not found: ${scan.busId}`);

    const routeId = bus.routeAssignments[0]?.routeId || '';

    // Record ridership event
    const event = await this.prisma.ridershipEvent.create({
      data: {
        studentCardId: studentCard.id,
        busId: scan.busId,
        routeId,
        scanType: scan.scanType,
        scanMethod: 'RFID',
        scannedAt: scan.timestamp,
      },
    });

    // Update bus student count
    const countDelta = scan.scanType === 'BOARD' ? 1 : -1;
    await this.prisma.bus.update({
      where: { id: scan.busId },
      data: { currentStudentCount: { increment: countDelta } },
    });

    const ridership: StudentRidership = {
      id: event.id,
      studentId: studentCard.id,
      studentName: studentCard.studentName,
      busId: scan.busId,
      routeId,
      stopId: '',
      scanType: scan.scanType,
      scannedAt: scan.timestamp,
      scanMethod: 'RFID',
      cardId: scan.cardId,
    };

    // Notify parents
    const notificationType: TransportNotificationType =
      scan.scanType === 'BOARD' ? TransportNotificationType.STUDENT_BOARDED : TransportNotificationType.STUDENT_EXITED;

    await this.notifyParents(studentCard.parentContacts, ridership, notificationType, bus.busNumber);

    return ridership;
  }

  /**
   * Process GPS update from a bus.
   */
  async processGpsUpdate(busId: string, position: GpsPosition): Promise<void> {
    // Update bus position
    await this.prisma.bus.update({
      where: { id: busId },
      data: {
        currentLatitude: position.latitude,
        currentLongitude: position.longitude,
        currentSpeed: position.speed,
        currentHeading: position.heading,
        lastGpsAt: position.timestamp,
      },
    });

    // Get bus routes and stops
    const bus = await this.prisma.bus.findUnique({
      where: { id: busId },
      include: {
        routeAssignments: {
          include: {
            route: {
              include: {
                stops: {
                  orderBy: { stopOrder: 'asc' },
                  include: { studentAssignments: { include: { studentCard: { include: { parentContacts: true } } } } },
                },
              },
            },
          },
        },
      },
    });

    if (!bus) return;

    for (const assignment of bus.routeAssignments) {
      const route = assignment.route;

      for (const stop of route.stops) {
        const distanceM = this.haversineDistance(
          position.latitude,
          position.longitude,
          stop.latitude,
          stop.longitude,
        ) * 1000; // km to meters

        // Check geofence: bus approaching stop
        if (distanceM <= this.config.geofenceRadiusMeters && distanceM > 50) {
          for (const sa of stop.studentAssignments) {
            if (sa.studentCard.parentContacts.length > 0) {
              const eta = this.calculateEtaFromDistance(distanceM, position.speed);
              await this.notifyParents(
                sa.studentCard.parentContacts,
                {
                  id: '',
                  studentId: sa.studentCard.id,
                  studentName: sa.studentCard.studentName,
                  busId,
                  routeId: route.id,
                  stopId: stop.id,
                  scanType: 'BOARD',
                  scannedAt: new Date(),
                  scanMethod: 'RFID',
                },
                TransportNotificationType.BUS_APPROACHING_STOP,
                bus.busNumber,
                { stopName: stop.name, eta: `${eta} min` },
              );
            }
          }
        }
      }

      // Check delay: compare scheduled vs actual time
      const now = new Date();
      const [schedHour, schedMin] = route.scheduledArrivalTime.split(':').map(Number);
      const scheduledArrival = new Date(now);
      scheduledArrival.setHours(schedHour, schedMin, 0, 0);

      if (now > scheduledArrival) {
        const delayMinutes = Math.round((now.getTime() - scheduledArrival.getTime()) / 60000);
        if (delayMinutes >= this.config.delayThresholdMinutes) {
          // Notify all parents on this route about delay
          for (const stop of route.stops) {
            for (const sa of stop.studentAssignments) {
              await this.notifyParents(
                sa.studentCard.parentContacts,
                {
                  id: '',
                  studentId: sa.studentCard.id,
                  studentName: sa.studentCard.studentName,
                  busId,
                  routeId: route.id,
                  stopId: stop.id,
                  scanType: 'BOARD',
                  scannedAt: new Date(),
                  scanMethod: 'RFID',
                },
                TransportNotificationType.BUS_DELAY,
                bus.busNumber,
                { delayMinutes },
              );
            }
          }
        }
      }
    }
  }

  /**
   * Check for missed bus events.
   */
  async checkMissedBus(routeId: string): Promise<void> {
    const route = await this.prisma.busRoute.findUnique({
      where: { id: routeId },
      include: {
        stops: {
          include: {
            studentAssignments: {
              include: { studentCard: { include: { parentContacts: true } } },
            },
          },
        },
        busAssignments: { include: { bus: true } },
      },
    });

    if (!route) return;

    const bus = route.busAssignments[0]?.bus;
    if (!bus) return;

    // Get today's board scans for this route
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayScans = await this.prisma.ridershipEvent.findMany({
      where: {
        routeId,
        scanType: 'BOARD',
        scannedAt: { gte: today, lt: tomorrow },
      },
    });

    const scannedStudentIds = new Set(todayScans.map((s) => s.studentCardId));

    // Find students assigned to this route who didn't scan
    for (const stop of route.stops) {
      for (const sa of stop.studentAssignments) {
        if (!scannedStudentIds.has(sa.studentCard.id) && sa.studentCard.isActive) {
          await this.notifyParents(
            sa.studentCard.parentContacts,
            {
              id: '',
              studentId: sa.studentCard.id,
              studentName: sa.studentCard.studentName,
              busId: bus.id,
              routeId,
              stopId: stop.id,
              scanType: 'BOARD',
              scannedAt: new Date(),
              scanMethod: 'RFID',
            },
            TransportNotificationType.MISSED_BUS,
            bus.busNumber,
          );
        }
      }
    }
  }

  /**
   * Calculate ETA to a stop based on current position and route.
   */
  calculateEta(currentPosition: GpsPosition, targetStop: BusStop): number {
    const distanceKm = this.haversineDistance(
      currentPosition.latitude,
      currentPosition.longitude,
      targetStop.location.latitude,
      targetStop.location.longitude,
    );

    const avgSpeedKmh = (currentPosition.speed || 25) * 1.60934;
    return Math.round((distanceKm / avgSpeedKmh) * 60);
  }

  private calculateEtaFromDistance(distanceMeters: number, speedMph?: number | null): number {
    const speedKmh = (speedMph || 25) * 1.60934;
    const distanceKm = distanceMeters / 1000;
    return Math.max(1, Math.round((distanceKm / speedKmh) * 60));
  }

  private async notifyParents(
    parentContacts: any[],
    ridership: StudentRidership,
    type: TransportNotificationType,
    busNumber: string,
    extra?: { stopName?: string; eta?: string; delayMinutes?: number },
  ): Promise<void> {
    const messages: Record<string, string> = {
      STUDENT_BOARDED: `${ridership.studentName} boarded Bus #${busNumber} at ${new Date(ridership.scannedAt).toLocaleTimeString()}`,
      STUDENT_EXITED: `${ridership.studentName} exited Bus #${busNumber} at ${new Date(ridership.scannedAt).toLocaleTimeString()}`,
      BUS_APPROACHING_STOP: `Bus #${busNumber} is approaching ${extra?.stopName || 'your stop'}. ETA: ${extra?.eta || '2 min'}`,
      BUS_ARRIVED_AT_SCHOOL: `Bus #${busNumber} has arrived at school`,
      BUS_DEPARTED_SCHOOL: `Bus #${busNumber} has departed school`,
      BUS_DELAY: `Bus #${busNumber} is running ~${extra?.delayMinutes || '?'} min late`,
      MISSED_BUS: `${ridership.studentName} did not board Bus #${busNumber} this morning`,
      ROUTE_DEVIATION: `Bus #${busNumber} has deviated from its scheduled route`,
      DRIVER_PANIC: `EMERGENCY: Alert triggered on Bus #${busNumber}`,
    };

    const message = messages[type] || `Transport update for Bus #${busNumber}`;

    for (const parent of parentContacts) {
      // Check parent preferences
      if (type === TransportNotificationType.STUDENT_BOARDED && !parent.boardAlerts) continue;
      if (type === TransportNotificationType.STUDENT_EXITED && !parent.exitAlerts) continue;
      if (type === TransportNotificationType.BUS_APPROACHING_STOP && !parent.etaAlerts) continue;
      if (type === TransportNotificationType.BUS_DELAY && !parent.delayAlerts) continue;
      if (type === TransportNotificationType.MISSED_BUS && !parent.missedBusAlerts) continue;

      // Build channels list based on parent preferences
      const channels: ('SMS' | 'EMAIL' | 'PUSH')[] = [];
      if (parent.smsEnabled && parent.phone) channels.push('SMS');
      if (parent.emailEnabled && parent.email) channels.push('EMAIL');
      if (parent.pushEnabled && parent.pushToken) channels.push('PUSH');

      if (channels.length === 0) continue;

      // Build recipient list
      const recipients: string[] = [];
      if (channels.includes('SMS') && parent.phone) recipients.push(parent.phone);
      if (channels.includes('EMAIL') && parent.email) recipients.push(parent.email);
      if (channels.includes('PUSH') && parent.pushToken) recipients.push(parent.pushToken);

      if (this.notificationRouter) {
        await this.notificationRouter.notify({
          alertId: `transport-${type}-${ridership.id}`,
          siteId: this.config.siteId,
          level: type === 'DRIVER_PANIC' ? 'ACTIVE_THREAT' : 'CUSTOM',
          message,
          recipients,
          channels,
        });
      } else {
        console.log(`[Transport] ${type}: ${message} → ${parent.parentName} (${channels.join(',')})`);
      }
    }
  }

  /**
   * Haversine formula for distance between two GPS coordinates.
   */
  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
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
