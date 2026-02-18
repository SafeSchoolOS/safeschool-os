import type { VisitorScreeningAdapter, ScreeningInput, ScreeningAdapterResult } from '../index.js';

/**
 * InformData SOR+ (Sex Offender Registry) Adapter
 *
 * Integrates with InformData's SOR+ API for real-time sex offender
 * screening against the National Sex Offender Public Website (NSOPW).
 *
 * Requires: INFORMDATA_API_KEY and INFORMDATA_API_URL env vars.
 */
export class InformDataSorAdapter implements VisitorScreeningAdapter {
  name = 'InformData SOR+';

  private apiUrl: string;
  private apiKey: string;

  constructor() {
    this.apiUrl = process.env.INFORMDATA_API_URL || '';
    this.apiKey = process.env.INFORMDATA_API_KEY || '';
  }

  async screen(input: ScreeningInput): Promise<ScreeningAdapterResult> {
    if (!this.apiUrl || !this.apiKey) {
      console.warn('[InformDataSorAdapter] API credentials not configured, returning ERROR');
      return {
        sexOffenderCheck: 'ERROR',
        watchlistCheck: 'ERROR',
        checkedAt: new Date(),
      };
    }

    try {
      const response = await fetch(`${this.apiUrl}/api/v1/screen`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          firstName: input.firstName,
          lastName: input.lastName,
          dateOfBirth: input.dateOfBirth,
          state: input.state,
          idNumber: input.idNumber,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`InformData API returned ${response.status}`);
      }

      const data: any = await response.json();

      return {
        sexOffenderCheck: data.sorMatch ? 'FLAGGED' : 'CLEAR',
        watchlistCheck: data.watchlistMatch ? 'FLAGGED' : 'CLEAR',
        checkedAt: new Date(),
      };
    } catch (err) {
      console.error('[InformDataSorAdapter] Screening failed:', err);
      return {
        sexOffenderCheck: 'ERROR',
        watchlistCheck: 'ERROR',
        checkedAt: new Date(),
      };
    }
  }
}
