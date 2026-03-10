// test-dashboard.ts — Seeds mock data and starts the dashboard for testing
import { createServer, addCandidate } from './src/dashboard/index.js';
import { ReviewCandidate } from './src/shared/types.js';
import { v4 as uuid } from 'uuid';

const now = new Date();

function mockCandidate(overrides: Partial<{ statement: string; mechanism: string; composite: number }>): ReviewCandidate {
  const id = uuid();
  return {
    insight: {
      id,
      puzzleId: uuid(),
      insightStatement: overrides.statement || 'Neural pruning mechanisms in developing brains mirror optimal compression algorithms in information theory, suggesting cognition is fundamentally a lossy encoding process.',
      mechanism: overrides.mechanism || 'Synaptic pruning removes low-weight connections analogously to how rate-distortion theory removes low-information components.',
      howItResolvesPuzzle: 'Explains why developing brains become more efficient despite losing neurons — they are optimizing for compression ratio.',
      initialPredictions: [
        'Pruning patterns should correlate with mutual information between connected regions',
        'Disorders with reduced pruning should show increased neural noise',
      ],
      enrichmentConceptIds: [],
      createdAt: now,
    },
    puzzle: {
      id: uuid(),
      conceptPairIds: [uuid(), uuid()],
      puzzleStatement: 'Why do developing brains lose ~50% of synapses yet gain cognitive ability?',
      whyHardToExplain: 'Naive expectation: more connections = more capability. Reality contradicts this.',
      stScore: { descriptionComplexity: 12, generationComplexity: 45, unexpectedness: 33 },
      createdAt: now,
      status: 'validated',
    },
    sourceConcepts: [
      {
        id: uuid(), text: 'Synaptic pruning eliminates weak neural connections during development, reducing synapse count by ~50% between early childhood and adulthood.',
        source: 'Huttenlocher 1979', domain: 'neuroscience',
        embedding: [], metadata: { addedBy: 'expert', addedAt: now, confidence: 'established', sourceType: 'manual' },
      },
      {
        id: uuid(), text: 'Rate-distortion theory defines the minimum bitrate needed to encode a source within a given distortion level.',
        source: 'Shannon 1959', domain: 'information theory',
        embedding: [], metadata: { addedBy: 'expert', addedAt: now, confidence: 'established', sourceType: 'manual' },
      },
    ],
    enrichmentConcepts: [],
    evaluation: {
      insightId: id,
      path: 'soft',
      adversarial: {
        attacks: [
          { vector: 'logical_coherence', severity: 3, finding: 'Analogy is structurally sound but causal link unproven.' },
          { vector: 'counterexamples', severity: 4, finding: 'Some pruning appears activity-independent.' },
          { vector: 'established_knowledge', severity: 2, finding: 'Consistent with Hebbian learning literature.' },
          { vector: 'simpler_explanation', severity: 5, finding: 'Could just be metabolic cost optimization.' },
          { vector: 'unfalsifiability', severity: 3, finding: 'Predictions are testable via imaging studies.' },
          { vector: 'rhetorical_mimicry', severity: 2, finding: 'Genuine structural parallel, not just metaphor.' },
        ],
        overallResilience: 7,
      },
      novelty: {
        existingWorks: [
          { title: 'Information-theoretic models of neural development', url: 'https://example.com/paper1', similarityAssessment: 'Related framing but does not propose compression as the primary driver.' },
        ],
        isNovel: true,
      },
      grounding: { contradictions: [], isGrounded: true },
      compositeScore: overrides.composite ?? 7.0,
      passesThreshold: true,
    },
  };
}

// Seed 3 candidates
addCandidate(mockCandidate({}));
addCandidate(mockCandidate({
  statement: 'Ant colony foraging algorithms converge to solutions equivalent to TCP congestion control, implying both systems discovered the same distributed optimization under resource constraints.',
  mechanism: 'Pheromone decay rate in ant trails functions identically to TCP timeout backoff — both implement multiplicative decrease / additive increase.',
  composite: 6.2,
}));
addCandidate(mockCandidate({
  statement: 'Urban gentrification follows the same phase-transition dynamics as magnetic domain flipping in ferromagnets, with property values acting as spin states.',
  mechanism: 'Neighborhood tipping points exhibit Ising-model criticality where local interactions cascade into macro-scale state changes.',
  composite: 5.4,
}));

console.log('Seeded 3 mock candidates.');
createServer(3000);
