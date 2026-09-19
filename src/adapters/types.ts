import type {
  AppMetadataObservation,
  RankingEntry,
  Source,
  Target
} from "../domain.js";

export interface AdapterObservation {
  target: Target;
  capturedAt: string;
  entries: RankingEntry[];
  source: Source;
  flags: string[];
  attempts: number;
  enrichmentContext: unknown;
}

export interface MetadataEnrichment {
  metadata: AppMetadataObservation[];
  flags: string[];
  attempts: number;
}

export interface StoreAdapter {
  collectRanking(target: Target): Promise<AdapterObservation>;
  enrichMetadata(observation: AdapterObservation): Promise<MetadataEnrichment>;
}
