import type { Capability, Category, Release } from './domain';

type RequirementBase = { quote: string; expected: boolean; priority: 'must' | 'prefer' };
export type Requirement = RequirementBase & (
  { kind: 'capability'; key: Capability } |
  { kind: 'stack' | 'deployment'; value: string } |
  { kind: 'recurring-budget'; value: number }
);
export type FinderBrief = {
  version: 1;
  requirements: Requirement[];
  budget: { cents: number; inclusive: boolean; quote: string } | null;
  category: { value: Category; quote: string } | null;
  ambiguities: { reason: string; quote: string }[];
};
export type EvidenceState = 'verified' | 'contradicted' | 'seller-claimed' | 'not-tested';
export type FinderEvidence = {
  label: string; key: Capability | null; priority: Requirement['priority']; state: EvidenceState;
  evidenceId: string | null; observation: string;
};
export type FinderResult = { item: Release; status: 'match' | 'near'; evidence: FinderEvidence[] };
export const blankFinderBrief: FinderBrief = { version: 1, requirements: [], budget: null, category: null, ambiguities: [] };
