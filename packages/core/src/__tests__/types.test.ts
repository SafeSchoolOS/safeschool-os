import { describe, it, expect } from 'vitest';
import {
  AlertLevel,
  AlertStatus,
  AlertSource,
  UserRole,
  DoorStatus,
  LockdownScope,
  DispatchMethod,
  DispatchStatus,
  OperatingMode,
  VisitorStatus,
} from '../types.js';

describe('Core Type Exports', () => {
  it('exports AlertLevel enum values', () => {
    expect(AlertLevel.MEDICAL).toBe('MEDICAL');
    expect(AlertLevel.LOCKDOWN).toBe('LOCKDOWN');
    expect(AlertLevel.ACTIVE_THREAT).toBe('ACTIVE_THREAT');
    expect(AlertLevel.FIRE).toBe('FIRE');
    expect(AlertLevel.WEATHER).toBe('WEATHER');
    expect(AlertLevel.ALL_CLEAR).toBe('ALL_CLEAR');
    expect(AlertLevel.CUSTOM).toBe('CUSTOM');
  });

  it('exports AlertStatus enum values', () => {
    expect(AlertStatus.TRIGGERED).toBe('TRIGGERED');
    expect(AlertStatus.ACKNOWLEDGED).toBe('ACKNOWLEDGED');
    expect(AlertStatus.DISPATCHED).toBe('DISPATCHED');
    expect(AlertStatus.RESPONDING).toBe('RESPONDING');
    expect(AlertStatus.RESOLVED).toBe('RESOLVED');
    expect(AlertStatus.CANCELLED).toBe('CANCELLED');
  });

  it('exports AlertSource enum values', () => {
    expect(AlertSource.WEARABLE).toBe('WEARABLE');
    expect(AlertSource.MOBILE_APP).toBe('MOBILE_APP');
    expect(AlertSource.DASHBOARD).toBe('DASHBOARD');
    expect(AlertSource.AUTOMATED).toBe('AUTOMATED');
  });

  it('exports UserRole enum values', () => {
    expect(UserRole.SUPER_ADMIN).toBe('SUPER_ADMIN');
    expect(UserRole.SITE_ADMIN).toBe('SITE_ADMIN');
    expect(UserRole.OPERATOR).toBe('OPERATOR');
    expect(UserRole.TEACHER).toBe('TEACHER');
    expect(UserRole.FIRST_RESPONDER).toBe('FIRST_RESPONDER');
    expect(UserRole.PARENT).toBe('PARENT');
  });

  it('exports DoorStatus enum values', () => {
    expect(DoorStatus.LOCKED).toBe('LOCKED');
    expect(DoorStatus.UNLOCKED).toBe('UNLOCKED');
    expect(DoorStatus.FORCED).toBe('FORCED');
  });

  it('exports LockdownScope enum values', () => {
    expect(LockdownScope.FULL_SITE).toBe('FULL_SITE');
    expect(LockdownScope.BUILDING).toBe('BUILDING');
    expect(LockdownScope.FLOOR).toBe('FLOOR');
    expect(LockdownScope.ZONE).toBe('ZONE');
  });

  it('exports DispatchMethod enum values', () => {
    expect(DispatchMethod.RAVE_911).toBe('RAVE_911');
    expect(DispatchMethod.SIP_DIRECT).toBe('SIP_DIRECT');
    expect(DispatchMethod.CELLULAR).toBe('CELLULAR');
  });

  it('exports DispatchStatus enum values', () => {
    expect(DispatchStatus.PENDING).toBe('PENDING');
    expect(DispatchStatus.SENT).toBe('SENT');
    expect(DispatchStatus.FAILED).toBe('FAILED');
  });

  it('exports OperatingMode enum values', () => {
    expect(OperatingMode.CLOUD).toBe('CLOUD');
    expect(OperatingMode.EDGE).toBe('EDGE');
    expect(OperatingMode.STANDALONE).toBe('STANDALONE');
  });

  it('exports VisitorStatus enum values', () => {
    expect(VisitorStatus.PRE_REGISTERED).toBe('PRE_REGISTERED');
    expect(VisitorStatus.CHECKED_IN).toBe('CHECKED_IN');
    expect(VisitorStatus.CHECKED_OUT).toBe('CHECKED_OUT');
    expect(VisitorStatus.DENIED).toBe('DENIED');
    expect(VisitorStatus.FLAGGED).toBe('FLAGGED');
  });
});
