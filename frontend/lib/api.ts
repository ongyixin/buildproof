// ──────────────────────────────────────────────────────────────────────────────
// BuildProof API Client
//
// All network calls go through this module.
// Backend base URL: http://localhost:8000 (override with NEXT_PUBLIC_API_URL)
// ──────────────────────────────────────────────────────────────────────────────

import type {
  SubmitProposalRequest,
  SubmitProposalResponse,
  BenchmarkResponse,
  ProposalResult,
  LeaderboardEntry,
  CalibrationEntry,
  ChainWeightSnapshot,
  ChainWeightHistory,
  ArenaResults,
  AdversarialProposalResult,
  EvaluationEvent,
} from '@/types/models'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      detail = body?.detail ?? detail
    } catch (_) {
      // ignore JSON parse errors on error bodies
    }
    const err = new Error(detail) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  return res.json() as Promise<T>
}

function isPendingNotFound(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const withStatus = err as Error & { status?: number }
  if (withStatus.status === 404) return true
  return err.message.startsWith('HTTP 404')
}

// ── Proposal submission ───────────────────────────────────────────────────────

export async function submitProposal(
  payload: SubmitProposalRequest
): Promise<SubmitProposalResponse> {
  return apiFetch<SubmitProposalResponse>('/proposals', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function runBenchmark(): Promise<BenchmarkResponse> {
  const resp = await apiFetch<{ enqueued: string[]; already_complete: string[]; message: string }>(
    '/benchmarks/run',
    { method: 'POST', body: JSON.stringify({}) }
  )
  const proposalId = resp.enqueued[0] ?? resp.already_complete[0]
  if (!proposalId) throw new Error('No benchmark proposals available')
  return { proposal_id: proposalId }
}

// ── Proposal results ──────────────────────────────────────────────────────────

export async function getProposalResult(proposalId: string): Promise<ProposalResult> {
  return apiFetch<ProposalResult>(`/proposals/${proposalId}/results`)
}

/**
 * Subscribe to proposal evaluation progress via SSE.
 * Falls back to polling if EventSource is unavailable.
 * Calls onUpdate with each incoming result, onComplete when finished.
 * Returns a cleanup function.
 */
export function subscribeProposalResult(
  proposalId: string,
  onUpdate: (result: ProposalResult) => void,
  onComplete: (result: ProposalResult) => void,
  onError: (err: Error) => void
): () => void {
  // Try SSE first (using the real events endpoint)
  if (typeof EventSource !== 'undefined') {
    try {
      const url = `${BASE_URL}/proposals/${proposalId}/events`
      const es = new EventSource(url)

      es.addEventListener('update', (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data) as ProposalResult
          onUpdate(data)
          if (data.status === 'complete' || data.status === 'error') {
            es.close()
            onComplete(data)
          }
        } catch (_) {
          // ignore parse errors
        }
      })

      es.addEventListener('error', () => {
        es.close()
        // Fall back to polling
        const cleanup = pollFallback(proposalId, onUpdate, onComplete, onError)
        cleanupRef = cleanup
      })

      let cleanupRef: () => void = () => es.close()
      return () => cleanupRef()
    } catch (_) {
      // Fall through to polling
    }
  }

  // Polling fallback
  return pollFallback(proposalId, onUpdate, onComplete, onError)
}

function pollFallback(
  proposalId: string,
  onUpdate: (result: ProposalResult) => void,
  onComplete: (result: ProposalResult) => void,
  onError: (err: Error) => void
): () => void {
  let cancelled = false
  const intervalMs = 2000
  const deadline = Date.now() + 120_000

  const tick = async () => {
    if (cancelled) return
    if (Date.now() > deadline) {
      onError(new Error('Proposal evaluation timed out after 2 minutes'))
      return
    }

    try {
      const result = await getProposalResult(proposalId)
      if (cancelled) return
      onUpdate(result)

      if (result.status === 'complete' || result.status === 'error') {
        onComplete(result)
      } else {
        setTimeout(tick, intervalMs)
      }
    } catch (err: unknown) {
      if (cancelled) return
      const isNotFound = isPendingNotFound(err)
      if (isNotFound) {
        setTimeout(tick, intervalMs)
      } else {
        onError(err instanceof Error ? err : new Error('Unknown error'))
      }
    }
  }

  tick()
  return () => { cancelled = true }
}

/**
 * Legacy polling helper (kept for backward compatibility).
 */
export async function pollProposalResult(
  proposalId: string,
  onUpdate: (result: ProposalResult) => void,
  intervalMs = 2000,
  timeoutMs = 120_000
): Promise<ProposalResult> {
  const deadline = Date.now() + timeoutMs

  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (Date.now() > deadline) {
        reject(new Error('Proposal evaluation timed out after 2 minutes'))
        return
      }

      try {
        const result = await getProposalResult(proposalId)
        onUpdate(result)

        if (result.status === 'complete' || result.status === 'error') {
          resolve(result)
        } else {
          setTimeout(tick, intervalMs)
        }
      } catch (err: unknown) {
        const isNotFound = isPendingNotFound(err)
        if (isNotFound) {
          setTimeout(tick, intervalMs)
        } else {
          reject(err)
        }
      }
    }

    tick()
  })
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const resp = await apiFetch<{ updated_at: number; entries: LeaderboardEntry[] }>('/leaderboard')
  return resp.entries ?? []
}

// ── Adversarial Arena ─────────────────────────────────────────────────────────

export async function runArena(): Promise<{ run_id: string; enqueued: string[]; already_complete: string[] }> {
  return apiFetch('/arena/run', { method: 'POST', body: JSON.stringify({}) })
}

export async function getArenaResults(): Promise<ArenaResults> {
  return apiFetch<ArenaResults>('/arena/results')
}

export async function getArenaProposalResult(proposalId: string): Promise<AdversarialProposalResult> {
  return apiFetch<AdversarialProposalResult>(`/arena/${proposalId}/result`)
}

// ── Chain weights ─────────────────────────────────────────────────────────────

export async function getChainWeights(): Promise<ChainWeightSnapshot> {
  return apiFetch<ChainWeightSnapshot>('/chain/weights')
}

export async function getChainWeightHistory(limit = 10): Promise<ChainWeightHistory> {
  return apiFetch<ChainWeightHistory>(`/chain/weights/history?limit=${limit}`)
}

// ── Calibration leaderboard ───────────────────────────────────────────────────

export async function getCalibrationLeaderboard(): Promise<{ entries: CalibrationEntry[] }> {
  return apiFetch<{ entries: CalibrationEntry[] }>('/leaderboard/calibration')
}

// ── Replay ────────────────────────────────────────────────────────────────────

export async function getReplayEvents(proposalId: string): Promise<{ events: EvaluationEvent[]; total: number }> {
  return apiFetch<{ events: EvaluationEvent[]; total: number }>(`/proposals/${proposalId}/replay`)
}

// ── Evaluation event stream ───────────────────────────────────────────────────

const TERMINAL_EVENT_TYPES = new Set(['decision_packet_ready'])

/**
 * Subscribe to structured evaluation events for a proposal via SSE.
 * Falls back to polling /events/poll if EventSource is unavailable.
 * Returns a cleanup function.
 */
export function subscribeEvaluationEvents(
  proposalId: string,
  onEvent: (event: EvaluationEvent) => void,
  onComplete: () => void
): () => void {
  if (typeof EventSource !== 'undefined') {
    try {
      const url = `${BASE_URL}/proposals/${proposalId}/events`
      const es = new EventSource(url)

      es.addEventListener('eval', (e) => {
        try {
          const ev = JSON.parse((e as MessageEvent).data) as EvaluationEvent
          onEvent(ev)
          if (TERMINAL_EVENT_TYPES.has(ev.event_type)) {
            es.close()
            onComplete()
          }
        } catch (_) {
          // ignore parse errors
        }
      })

      es.addEventListener('timeout', () => {
        es.close()
        onComplete()
      })

      es.addEventListener('error', () => {
        es.close()
        // Fall back to polling
        const cleanup = pollEvaluationEvents(proposalId, onEvent, onComplete)
        cleanupRef = cleanup
      })

      let cleanupRef: () => void = () => es.close()
      return () => cleanupRef()
    } catch (_) {
      // Fall through to polling
    }
  }

  return pollEvaluationEvents(proposalId, onEvent, onComplete)
}

function pollEvaluationEvents(
  proposalId: string,
  onEvent: (event: EvaluationEvent) => void,
  onComplete: () => void
): () => void {
  let cancelled = false
  let cursor = 0
  const deadline = Date.now() + 130_000

  const tick = async () => {
    if (cancelled) return
    if (Date.now() > deadline) { onComplete(); return }

    try {
      const resp = await apiFetch<{ events: EvaluationEvent[] }>(
        `/proposals/${proposalId}/events/poll?after_id=${cursor}`
      )
      if (cancelled) return
      for (const ev of resp.events) {
        cursor = ev.id
        onEvent(ev)
        if (TERMINAL_EVENT_TYPES.has(ev.event_type)) {
          onComplete()
          return
        }
      }
    } catch (_) {
      // ignore transient errors
    }

    setTimeout(tick, 800)
  }

  tick()
  return () => { cancelled = true }
}

// ── Direct evaluation (fallback when bittensor validator is not running) ─────

/**
 * Trigger in-process evaluation on the API server.
 * Uses miner strategies directly — no bittensor stack required.
 * When ENABLE_EXTERNAL_API_CALLS=false, strategies use seeded/rule-based paths.
 */
export async function triggerDirectEvaluation(proposalId: string): Promise<ProposalResult> {
  return apiFetch<ProposalResult>(`/proposals/${proposalId}/evaluate-direct`, {
    method: 'POST',
  })
}

// ── Mock / fallback data ──────────────────────────────────────────────────────

/**
 * Complete seeded ProposalResult used as the final UI fallback when both the
 * bittensor validator and the API direct-eval endpoint are unreachable.
 * All values are deterministic so the demo UI looks consistent.
 */
export const MOCK_PROPOSAL_RESULT: ProposalResult = {
  proposal_id: 'demo_fallback',
  proposal_text:
    'We are building an open-source verification layer for grant applications. ' +
    'Requesting $18,000. Team: 2 senior engineers. ' +
    'Milestones: schema (Month 1), SDK (Month 2–3), integration (Month 4–5), audit (Month 6).',
  status: 'complete',
  is_adversarial: false,
  evaluated_at: Date.now() / 1000,
  consensus_recommendation: 'fund',
  decision: {
    recommendation: 'fund',
    recommended_amount: null,
    consensus_confidence: 0.81,
    rationale: 'Consensus across 3 miners: fund. Strong feasibility and clarity scores.',
    dissenting_views: [],
    disagreement_score: 0.04,
    disagreement_reason: null,
  },
  miner_responses: [
    {
      uid: 1,
      hotkey: '5GrwV...E4',
      task_type: 'rubric',
      strategy: 'rubric_scorer',
      backend: 'seeded-deterministic',
      score_vector: {
        feasibility: 0.82,
        impact: 0.76,
        novelty: 0.68,
        budget_reasonableness: 0.79,
        clarity: 0.88,
        mandate_alignment: 0.84,
        confidence_by_dimension: {
          feasibility: 0.81,
          impact: 0.62,
          novelty: 0.55,
          budget_reasonableness: 0.91,
          clarity: 0.87,
          mandate_alignment: 0.74,
        },
      },
      diligence_questions: null,
      risk_assessment: null,
      latency_ms: 142,
      estimated_cost_usd: 0.0,
      score: {
        quality: 0.796,
        calibration: 0.714,
        robustness: 0.820,
        efficiency: 0.886,
        anti_gaming: 0.0,
        composite: 0.784,
        penalties: {},
      },
      reward: 0.784,
      reward_share: 0.407,
    },
    {
      uid: 2,
      hotkey: '5FHne...W7',
      task_type: 'diligence',
      strategy: 'diligence_generator',
      backend: 'rule-based',
      score_vector: null,
      diligence_questions: {
        questions: [
          'What is the plan for maintaining the project after the grant period?',
          'What alternative approaches were considered?',
        ],
        missing_evidence: [
          'No evidence found for: sustainability',
          'No evidence found for: alternatives',
        ],
        missing_milestones: [],
        coverage_summary:
          'Proposal covers 8/10 key areas (80%). Gaps: sustainability, alternatives.',
      },
      risk_assessment: null,
      latency_ms: 38,
      estimated_cost_usd: 0.0,
      score: {
        quality: 0.770,
        calibration: 0.750,
        robustness: 0.800,
        efficiency: 0.962,
        anti_gaming: 0.0,
        composite: 0.772,
        penalties: {},
      },
      reward: 0.772,
      reward_share: 0.400,
    },
    {
      uid: 3,
      hotkey: '5DAno...K3',
      task_type: 'risk',
      strategy: 'risk_detector',
      backend: 'rule-based',
      score_vector: null,
      diligence_questions: null,
      risk_assessment: {
        fraud_risk: 0.05,
        mandate_mismatch: 0.08,
        manipulation_flags: [],
        confidence_per_flag: {},
        reasoning: 'No significant risks detected.',
      },
      latency_ms: 12,
      estimated_cost_usd: 0.0,
      score: {
        quality: 0.700,
        calibration: 0.700,
        robustness: 0.800,
        efficiency: 0.999,
        anti_gaming: 0.0,
        composite: 0.745,
        penalties: {},
      },
      reward: 0.745,
      reward_share: 0.386,
    },
  ],
}

/** Mock chain weight snapshot used when the subtensor chain is not running. */
export const MOCK_CHAIN_WEIGHTS: ChainWeightSnapshot = {
  weights: [
    { uid: 1, weight: 0.412 },
    { uid: 2, weight: 0.342 },
    { uid: 3, weight: 0.246 },
  ],
  snapshot_at: Date.now() / 1000,
}

export const MOCK_LEADERBOARD: LeaderboardEntry[] = [
  {
    uid: 1,
    hotkey: '5GrwV...E4',
    task_type: 'rubric',
    strategy: 'rubric_scorer',
    composite_score: 0.847,
    avg_quality: 0.82,
    avg_calibration: 0.79,
    avg_robustness: 0.91,
    avg_efficiency: 0.88,
    avg_composite: 0.847,
    total_reward: 4.12,
    reward_share: 0.412,
    latency_ms: 4820,
    estimated_cost_usd: 0.0038,
    on_chain_weight: 0.412,
    weight: 0.412,
    proposals_evaluated: 24,
    rank: 1,
  },
  {
    uid: 2,
    hotkey: '5FHne...W7',
    task_type: 'diligence',
    strategy: 'diligence_generator',
    composite_score: 0.791,
    avg_quality: 0.77,
    avg_calibration: 0.82,
    avg_robustness: 0.74,
    avg_efficiency: 0.95,
    avg_composite: 0.791,
    total_reward: 3.42,
    reward_share: 0.342,
    latency_ms: 2340,
    estimated_cost_usd: 0.0019,
    on_chain_weight: 0.342,
    weight: 0.342,
    proposals_evaluated: 24,
    rank: 2,
  },
  {
    uid: 3,
    hotkey: '5DAno...K3',
    task_type: 'risk',
    strategy: 'risk_detector',
    composite_score: 0.633,
    avg_quality: 0.68,
    avg_calibration: 0.61,
    avg_robustness: 0.58,
    avg_efficiency: 0.72,
    avg_composite: 0.633,
    total_reward: 2.46,
    reward_share: 0.246,
    latency_ms: 890,
    estimated_cost_usd: 0.0008,
    on_chain_weight: 0.246,
    weight: 0.246,
    proposals_evaluated: 24,
    rank: 3,
  },
]
