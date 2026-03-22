// ──────────────────────────────────────────────────────────────────────────────
// BuildProof Frontend Type Contracts
// Aligned with: api/models.py MinerOutput, ValidatorScores, FundingDecision
// ──────────────────────────────────────────────────────────────────────────────

// ── Task types ───────────────────────────────────────────────────────────────

export type TaskType = 'rubric' | 'diligence' | 'risk'
export type Recommendation = 'fund' | 'fund_with_conditions' | 'reject' | 'escalate'

// ── Typed miner output payloads ──────────────────────────────────────────────

export interface ScoreVector {
  feasibility: number
  impact: number
  novelty: number
  budget_reasonableness: number
  clarity: number
  mandate_alignment: number
  confidence_by_dimension?: Record<string, number>
}

export interface DiligenceQuestions {
  questions: string[]
  missing_evidence: string[]
  missing_milestones: string[]
  coverage_summary?: string
}

export interface RiskAssessment {
  fraud_risk: number
  mandate_mismatch: number
  manipulation_flags: string[]
  confidence_per_flag?: Record<string, number>
  reasoning?: string
}

// ── Validator scoring breakdown ───────────────────────────────────────────────

export interface ValidatorScore {
  quality: number
  calibration: number
  robustness: number
  efficiency: number
  anti_gaming: number
  composite: number
  task_metrics?: Record<string, number>
  penalties?: Record<string, number>
}

// ── Per-miner output (matches api/models.py MinerOutput) ─────────────────────

export interface MinerResponse {
  uid: number
  hotkey: string | null
  task_type: TaskType
  strategy: string
  backend: string
  score_vector: ScoreVector | null
  diligence_questions: DiligenceQuestions | null
  risk_assessment: RiskAssessment | null
  latency_ms: number
  estimated_cost_usd: number
  score: ValidatorScore
  reward: number
  reward_share: number
}

// Legacy alias for gradual migration
export type MinerOutput = MinerResponse

// ── Helper: derive recommendation from score_vector ──────────────────────────

export function deriveRecommendation(miner: MinerResponse): Recommendation {
  if (miner.risk_assessment && miner.risk_assessment.fraud_risk > 0.6) return 'reject'
  if (miner.score_vector) {
    const avg = (
      miner.score_vector.feasibility +
      miner.score_vector.impact +
      miner.score_vector.clarity +
      miner.score_vector.mandate_alignment
    ) / 4
    if (avg >= 0.65) return 'fund'
    if (avg >= 0.40) return 'fund_with_conditions'
    return 'reject'
  }
  return 'reject'
}

export function deriveConfidence(miner: MinerResponse): number {
  if (miner.score_vector?.confidence_by_dimension) {
    const vals = Object.values(miner.score_vector.confidence_by_dimension)
    if (vals.length > 0) return vals.reduce((s, v) => s + v, 0) / vals.length
  }
  return miner.score.composite
}

// ── Consensus funding decision ────────────────────────────────────────────────

export interface FundingDecision {
  recommendation: Recommendation
  recommended_amount: number | null
  consensus_confidence: number
  rationale: string
  dissenting_views: string[]
  disagreement_score?: number
  disagreement_reason?: string | null
}

// ── Full proposal result ──────────────────────────────────────────────────────

export type ProposalStatus = 'pending' | 'processing' | 'complete' | 'error'

export interface ProposalResult {
  proposal_id: string
  proposal_text: string
  program_mandate?: string
  status: ProposalStatus
  is_adversarial?: boolean
  miner_responses: MinerResponse[]
  consensus_recommendation?: string | null
  decision: FundingDecision | null
  evaluated_at?: number
  error_message?: string
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  uid: number
  hotkey: string | null
  task_type: string
  strategy: string
  proposals_evaluated: number
  avg_quality: number
  avg_calibration: number
  avg_robustness: number
  avg_efficiency: number
  avg_composite: number
  composite_score: number
  total_reward: number
  reward_share: number
  on_chain_weight: number | null
  weight: number | null
  latency_ms: number
  estimated_cost_usd: number
  rank: number
}

// ── Calibration leaderboard ───────────────────────────────────────────────────

export interface CalibrationEntry {
  uid: number
  task_type: string
  proposals_evaluated: number
  calibration_score: number
  overconfidence_rate: number
  avg_quality: number
  avg_composite: number
  task_calibration: number
}

// ── Chain weights ─────────────────────────────────────────────────────────────

export interface WeightEntry {
  uid: number
  weight: number
}

export interface ChainWeightSnapshot {
  weights: WeightEntry[]
  snapshot_at: number | null
}

export interface ChainWeightHistory {
  history: Array<{
    epoch: number
    snapshot_at: number
    weights: WeightEntry[]
  }>
  count: number
}

// ── Adversarial arena ─────────────────────────────────────────────────────────

export type AttackType =
  | 'prompt_injection'
  | 'fake_traction'
  | 'emotional_manipulation'
  | 'milestone_padding'
  | 'jargon_overload'
  | 'scope_bait_and_switch'
  | 'credential_inflation'
  | 'combined'
  | string

export type Severity = 'critical' | 'high' | 'medium' | 'low'

export interface AdversarialMinerResult {
  uid: number
  task_type: string
  backend: string
  fraud_risk: number
  manipulation_flags: string[]
  was_fooled: boolean
  required_fraud_risk_min: number
  expected_flags?: string[]
  flags_found?: string[]
  flag_recall?: number
  robustness_score: number
  composite_score: number
  reward_share: number
  latency_ms: number
}

export interface AdversarialProposalResult {
  proposal_id: string
  attack_type: AttackType
  title: string
  severity: Severity
  trap_description: string
  expected_fraud_risk_min: number
  expected_flags: string[]
  miner_results: AdversarialMinerResult[]
  total_caught?: number
  total_fooled?: number
}

export interface ArenaResults {
  proposals: AdversarialProposalResult[]
  summary: {
    total_proposals: number
    total_caught: number
    total_fooled: number
    detection_rate: number
  }
}

// ── Evaluation event stream ───────────────────────────────────────────────────

export type EvaluationEventType =
  | 'proposal_queued'
  | 'proposal_claimed'
  | 'synapse_built'
  | 'miner_query_sent'
  | 'miner_response_received'
  | 'miner_timeout'
  | 'reward_scored'
  | 'ema_updated'
  | 'weights_submitted'
  | 'decision_packet_ready'

export interface EvaluationEvent {
  id: number
  proposal_id: string
  timestamp: number
  event_type: EvaluationEventType
  source: string
  target?: string | null
  payload: Record<string, unknown>
}

// ── API request/response shapes ───────────────────────────────────────────────

export interface SubmitProposalRequest {
  proposal_text: string
  title?: string
  program_mandate?: string
}

export interface SubmitProposalResponse {
  proposal_id: string
  status: string
}

export interface BenchmarkResponse {
  proposal_id: string
}

export interface ApiError {
  detail: string
}
