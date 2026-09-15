export type FailureCacheKey = string

export type CachedFailure =
  | { kind: "iteration_limit"; iterations: number }
  | { kind: "failure"; iterations: number; error: string | null }

/** A bounded cache owned by the caller and shared by deterministic searches. */
export class HighDensitySolverFailureCache {
  private entries = new Map<FailureCacheKey, CachedFailure>()
  hits = 0
  misses = 0

  constructor(private readonly maxEntries = 128) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("Failure cache capacity must be a positive integer")
    }
  }

  get(key: FailureCacheKey): CachedFailure | undefined {
    const failure = this.entries.get(key)
    if (!failure) {
      this.misses++
      return undefined
    }
    this.hits++
    this.entries.delete(key)
    this.entries.set(key, failure)
    return failure
  }

  set(key: FailureCacheKey, failure: CachedFailure): void {
    this.entries.delete(key)
    this.entries.set(key, failure)
    if (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value
      if (oldestKey === undefined) {
        throw new Error("Nonempty failure cache has no oldest entry")
      }
      this.entries.delete(oldestKey)
    }
  }
}
