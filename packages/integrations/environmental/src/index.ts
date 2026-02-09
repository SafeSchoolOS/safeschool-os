/**
 * SafeSchool Environmental Monitoring Integration
 *
 * Interfaces with fire alarm panels, air quality sensors, weather stations,
 * and other environmental monitoring systems.
 */

export interface EnvironmentalAlert {
  sensorId: string;
  sensorType: string;
  value: number;
  unit: string;
  threshold: number;
  location: string;
  timestamp: Date;
}

export interface SensorAdapter {
  name: string;
  poll(): Promise<SensorReading[]>;
  getStatus(): Promise<{ online: boolean; lastReading?: Date }>;
}

export interface SensorReading {
  sensorId: string;
  value: number;
  unit: string;
  isAlert: boolean;
  timestamp: Date;
}

// Thresholds for automated alert generation
export const ALERT_THRESHOLDS: Record<string, { value: number; unit: string; comparison: 'gt' | 'lt' }> = {
  CO_DETECTOR: { value: 35, unit: 'ppm', comparison: 'gt' },     // CO > 35 ppm
  AIR_QUALITY: { value: 150, unit: 'AQI', comparison: 'gt' },    // AQI > 150 (unhealthy)
  TEMPERATURE: { value: 95, unit: 'F', comparison: 'gt' },       // Temp > 95F
  HUMIDITY: { value: 80, unit: '%', comparison: 'gt' },           // Humidity > 80%
};

/**
 * Check if a reading exceeds alert thresholds
 */
export function isAlertCondition(sensorType: string, value: number): boolean {
  const threshold = ALERT_THRESHOLDS[sensorType];
  if (!threshold) return false;

  if (threshold.comparison === 'gt') return value > threshold.value;
  return value < threshold.value;
}

/**
 * Console-based sensor adapter for development/testing
 */
export class ConsoleSensorAdapter implements SensorAdapter {
  name = 'console';

  async poll(): Promise<SensorReading[]> {
    console.log('[ConsoleSensorAdapter] Polling sensors...');
    return [];
  }

  async getStatus(): Promise<{ online: boolean; lastReading?: Date }> {
    return { online: true, lastReading: new Date() };
  }
}
