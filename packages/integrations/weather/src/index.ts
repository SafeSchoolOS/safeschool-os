/**
 * SafeSchool Weather Alert Integration
 *
 * Fetches active weather alerts from the National Weather Service (NWS) API
 * and surfaces them in the SafeSchool dashboard. Extreme/Severe alerts
 * automatically create WEATHER-level system alerts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WeatherAlert {
  id: string;
  event: string;
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  urgency: string;
  headline: string;
  description: string;
  onset: string;
  expires: string;
}

export interface WeatherAdapter {
  getActiveAlerts(lat: number, lon: number): Promise<WeatherAlert[]>;
}

// ---------------------------------------------------------------------------
// NWS GeoJSON response shapes (subset we care about)
// ---------------------------------------------------------------------------

interface NWSFeature {
  id: string;
  properties: {
    event: string;
    severity: string;
    urgency: string;
    headline: string | null;
    description: string | null;
    onset: string | null;
    expires: string | null;
  };
}

interface NWSAlertResponse {
  features: NWSFeature[];
}

// ---------------------------------------------------------------------------
// NWSAdapter — production adapter that calls the real NWS API
// ---------------------------------------------------------------------------

export class NWSAdapter implements WeatherAdapter {
  private baseUrl = 'https://api.weather.gov/alerts/active';

  async getActiveAlerts(lat: number, lon: number): Promise<WeatherAlert[]> {
    // NWS requires coordinates rounded to 4 decimal places max
    const point = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    const url = `${this.baseUrl}?point=${point}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SafeSchool/1.0 (school-safety-platform)',
        Accept: 'application/geo+json',
      },
    });

    if (!response.ok) {
      throw new Error(`NWS API returned ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as NWSAlertResponse;

    return data.features.map((feature) => ({
      id: feature.id,
      event: feature.properties.event,
      severity: normalizeSeverity(feature.properties.severity),
      urgency: feature.properties.urgency ?? 'Unknown',
      headline: feature.properties.headline ?? feature.properties.event,
      description: feature.properties.description ?? '',
      onset: feature.properties.onset ?? new Date().toISOString(),
      expires: feature.properties.expires ?? '',
    }));
  }
}

// ---------------------------------------------------------------------------
// ConsoleWeatherAdapter — dev/test adapter that returns no alerts
// ---------------------------------------------------------------------------

export class ConsoleWeatherAdapter implements WeatherAdapter {
  async getActiveAlerts(lat: number, lon: number): Promise<WeatherAlert[]> {
    console.log(`[ConsoleWeatherAdapter] getActiveAlerts(${lat}, ${lon}) — returning empty`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeSeverity(raw: string): WeatherAlert['severity'] {
  switch (raw) {
    case 'Extreme':
      return 'Extreme';
    case 'Severe':
      return 'Severe';
    case 'Moderate':
      return 'Moderate';
    case 'Minor':
      return 'Minor';
    default:
      return 'Unknown';
  }
}
