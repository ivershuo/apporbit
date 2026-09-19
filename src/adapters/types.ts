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
  metadata: AppMetadataObservation[];
  source: Source;
  flags: string[];
  attempts: number;
}

export interface StoreAdapter {
  collect(target: Target): Promise<AdapterObservation>;
}

