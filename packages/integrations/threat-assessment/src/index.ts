/**
 * SafeSchool Behavioral Threat Assessment Integration
 *
 * Provides structured threat assessment workflows aligned with
 * the Comprehensive School Threat Assessment Guidelines (CSTAG)
 * by Dewey Cornell. Supports multi-tier assessment, risk scoring,
 * and automated escalation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThreatAssessmentInput {
  subjectName: string;
  subjectGrade?: string;
  subjectRole: 'student' | 'staff' | 'visitor';
  category: string;
  description: string;
  evidence?: Record<string, unknown>;
  reportedById?: string;
}

export interface RiskScore {
  level: 'LOW' | 'MODERATE' | 'HIGH' | 'IMMINENT';
  score: number; // 0-100
  factors: RiskFactor[];
  recommendation: string;
}

export interface RiskFactor {
  name: string;
  weight: number;
  present: boolean;
  details?: string;
}

export interface AssessmentResult {
  riskScore: RiskScore;
  suggestedActions: string[];
  requiresLawEnforcement: boolean;
  requiresParentNotification: boolean;
}

// ---------------------------------------------------------------------------
// Adapter Interface
// ---------------------------------------------------------------------------

export interface ThreatAssessmentAdapter {
  name: string;
  /** Submit a threat report to the external assessment system */
  submitReport(input: ThreatAssessmentInput): Promise<{ externalId: string }>;
  /** Get risk assessment from the external system */
  getAssessment(externalId: string): Promise<AssessmentResult>;
  /** Sync status from external system */
  syncStatus(externalId: string): Promise<{ status: string; updatedAt: Date }>;
}

// ---------------------------------------------------------------------------
// CSTAG-based Risk Scoring (built-in)
// ---------------------------------------------------------------------------

/** Risk factors based on the CSTAG model */
const RISK_FACTORS: RiskFactor[] = [
  { name: 'Specific target identified', weight: 15, present: false },
  { name: 'Specific plan articulated', weight: 15, present: false },
  { name: 'Access to weapons', weight: 20, present: false },
  { name: 'Prior violent behavior', weight: 10, present: false },
  { name: 'Recent stressors or losses', weight: 5, present: false },
  { name: 'Social isolation', weight: 5, present: false },
  { name: 'Fixation on violence', weight: 10, present: false },
  { name: 'Substance abuse', weight: 5, present: false },
  { name: 'Mental health concerns', weight: 5, present: false },
  { name: 'Communication of intent', weight: 10, present: false },
];

/**
 * Score risk based on CSTAG factors.
 * Accepts an array of factor names that are present.
 */
export function scoreRisk(presentFactors: string[]): RiskScore {
  const factors = RISK_FACTORS.map((f) => ({
    ...f,
    present: presentFactors.includes(f.name),
  }));

  const score = factors.reduce((sum, f) => sum + (f.present ? f.weight : 0), 0);

  let level: RiskScore['level'];
  let recommendation: string;

  if (score >= 60) {
    level = 'IMMINENT';
    recommendation = 'Immediately notify law enforcement and administration. Remove subject from campus. Contact parents/guardians.';
  } else if (score >= 40) {
    level = 'HIGH';
    recommendation = 'Convene threat assessment team within 24 hours. Notify administration. Consider protective action.';
  } else if (score >= 20) {
    level = 'MODERATE';
    recommendation = 'Schedule threat assessment team review within 72 hours. Notify counselor. Monitor situation.';
  } else {
    level = 'LOW';
    recommendation = 'Document and monitor. Follow up with counselor. No immediate action required.';
  }

  return { level, score, factors, recommendation };
}

/**
 * Determine actions based on risk assessment
 */
export function getAssessmentActions(riskScore: RiskScore): AssessmentResult {
  const suggestedActions: string[] = [];
  const requiresLawEnforcement = riskScore.level === 'IMMINENT' || riskScore.score >= 50;
  const requiresParentNotification = riskScore.level !== 'LOW';

  if (riskScore.level === 'IMMINENT') {
    suggestedActions.push('Notify law enforcement immediately');
    suggestedActions.push('Secure campus - consider lockdown');
    suggestedActions.push('Remove subject from campus');
    suggestedActions.push('Contact parents/guardians');
    suggestedActions.push('Convene emergency threat assessment team');
  } else if (riskScore.level === 'HIGH') {
    suggestedActions.push('Convene threat assessment team within 24 hours');
    suggestedActions.push('Notify school administration');
    suggestedActions.push('Contact parents/guardians');
    suggestedActions.push('Consider protective action plan');
    suggestedActions.push('Document all observations');
  } else if (riskScore.level === 'MODERATE') {
    suggestedActions.push('Schedule counselor meeting');
    suggestedActions.push('Review within 72 hours');
    suggestedActions.push('Monitor behavioral indicators');
    suggestedActions.push('Document concerns');
  } else {
    suggestedActions.push('Document the report');
    suggestedActions.push('Follow up with counselor');
    suggestedActions.push('Monitor for escalation');
  }

  return {
    riskScore,
    suggestedActions,
    requiresLawEnforcement,
    requiresParentNotification,
  };
}

// ---------------------------------------------------------------------------
// Console Adapter (Development)
// ---------------------------------------------------------------------------

export class ConsoleThreatAssessmentAdapter implements ThreatAssessmentAdapter {
  name = 'console';

  async submitReport(input: ThreatAssessmentInput): Promise<{ externalId: string }> {
    console.log(`[ConsoleThreatAssessment] Report submitted: ${input.subjectName} - ${input.category}`);
    return { externalId: `console-${Date.now()}` };
  }

  async getAssessment(_externalId: string): Promise<AssessmentResult> {
    console.log(`[ConsoleThreatAssessment] Assessment requested: ${_externalId}`);
    return getAssessmentActions(scoreRisk([]));
  }

  async syncStatus(_externalId: string): Promise<{ status: string; updatedAt: Date }> {
    return { status: 'REPORTED', updatedAt: new Date() };
  }
}

// ---------------------------------------------------------------------------
// Navigate360 Adapter
// ---------------------------------------------------------------------------

export class Navigate360Adapter implements ThreatAssessmentAdapter {
  name = 'navigate360';
  private apiUrl: string;
  private apiKey: string;

  constructor(config: { apiUrl: string; apiKey: string }) {
    this.apiUrl = config.apiUrl;
    this.apiKey = config.apiKey;
  }

  async submitReport(input: ThreatAssessmentInput): Promise<{ externalId: string }> {
    const response = await fetch(`${this.apiUrl}/api/v1/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        subject_name: input.subjectName,
        subject_grade: input.subjectGrade,
        category: input.category,
        description: input.description,
        evidence: input.evidence,
      }),
    });

    if (!response.ok) {
      throw new Error(`Navigate360 API error: ${response.status}`);
    }

    const data = await response.json() as { id: string };
    return { externalId: data.id };
  }

  async getAssessment(externalId: string): Promise<AssessmentResult> {
    const response = await fetch(`${this.apiUrl}/api/v1/reports/${externalId}/assessment`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    });

    if (!response.ok) {
      throw new Error(`Navigate360 API error: ${response.status}`);
    }

    const data = await response.json() as {
      risk_level: string;
      risk_score: number;
      factors: Array<{ name: string; weight: number; present: boolean }>;
      actions: string[];
      requires_le: boolean;
      requires_parent: boolean;
    };

    return {
      riskScore: {
        level: data.risk_level as RiskScore['level'],
        score: data.risk_score,
        factors: data.factors,
        recommendation: '',
      },
      suggestedActions: data.actions,
      requiresLawEnforcement: data.requires_le,
      requiresParentNotification: data.requires_parent,
    };
  }

  async syncStatus(externalId: string): Promise<{ status: string; updatedAt: Date }> {
    const response = await fetch(`${this.apiUrl}/api/v1/reports/${externalId}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    });

    if (!response.ok) {
      throw new Error(`Navigate360 API error: ${response.status}`);
    }

    const data = await response.json() as { status: string; updated_at: string };
    return { status: data.status, updatedAt: new Date(data.updated_at) };
  }
}
