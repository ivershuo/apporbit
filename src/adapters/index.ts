import type { Store, Target } from "../domain.js";
import { AppleAdapter } from "./apple.js";
import { GooglePlayAdapter } from "./google-play.js";
import type { StoreAdapter } from "./types.js";

export class AdapterRegistry {
  readonly #adapters: Record<Store, StoreAdapter>;

  constructor(adapters?: Partial<Record<Store, StoreAdapter>>) {
    this.#adapters = {
      apple: adapters?.apple ?? new AppleAdapter(),
      "google-play": adapters?.["google-play"] ?? new GooglePlayAdapter()
    };
  }

  forTarget(target: Target): StoreAdapter {
    return this.#adapters[target.store];
  }
}

