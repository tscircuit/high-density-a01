import type { BaseSolver } from "@tscircuit/solver-utils"
import type { HighDensitySolverA01Props } from "./HighDensitySolverA01/HighDensitySolverA01"
import type { HighDensitySolverA03Props } from "./HighDensitySolverA03/HighDensitySolverA03"
import type {
  FailureCacheKey,
  HighDensitySolverFailureCache,
} from "./HighDensitySolverFailureCache"

type HighDensitySolverFailureCacheInput =
  | { solverName: "a01"; constructorProps: HighDensitySolverA01Props }
  | { solverName: "a03"; constructorProps: HighDensitySolverA03Props }

type FailureCacheSolverState = Pick<
  BaseSolver,
  "MAX_ITERATIONS" | "iterations" | "solved" | "failed" | "error" | "stats"
>

/** Keeps cache identity tied to the complete input and the effective budget. */
export class HighDensitySolverFailureCacheController {
  private readonly inputKey?: string
  private cacheKey?: FailureCacheKey
  private initialIterationLimit?: number
  private checkedCache = false
  private replayedFailure = false

  constructor(
    input: HighDensitySolverFailureCacheInput,
    private readonly highDensitySolverFailureCache: HighDensitySolverFailureCache,
  ) {
    // Callbacks can depend on mutable state and cannot be identified by JSON.
    // The cache is passed separately, so its contents never enter this key.
    if (input.constructorProps.initialPenaltyFn === undefined) {
      this.inputKey = JSON.stringify(input)
    }
  }

  replayFailure(solver: FailureCacheSolverState): boolean {
    if (this.checkedCache || this.inputKey === undefined) return false
    this.checkedCache = true
    this.initialIterationLimit = solver.MAX_ITERATIONS
    this.cacheKey = JSON.stringify([
      this.inputKey,
      String(solver.MAX_ITERATIONS),
    ])
    const failure = this.highDensitySolverFailureCache.get(this.cacheKey)
    if (!failure) return false

    this.replayedFailure = true
    solver.iterations = failure.iterations
    solver.stats.failureCacheHit = true
    if (failure.kind === "failure") {
      solver.failed = true
      solver.error = failure.error
    }
    // BaseSolver still runs final acceptance and reports iteration-limit errors.
    return true
  }

  recordFailure(solver: FailureCacheSolverState): void {
    if (!solver.failed || !this.canRecord(solver)) return
    this.highDensitySolverFailureCache.set(this.cacheKey!, {
      kind: "failure",
      iterations: solver.iterations,
      error: solver.error,
    })
  }

  recordIterationLimit(solver: FailureCacheSolverState): void {
    if (
      solver.solved ||
      solver.iterations < solver.MAX_ITERATIONS ||
      !this.canRecord(solver)
    ) {
      return
    }
    this.highDensitySolverFailureCache.set(this.cacheKey!, {
      kind: "iteration_limit",
      iterations: solver.iterations,
    })
  }

  private canRecord(solver: FailureCacheSolverState): boolean {
    return (
      !this.replayedFailure &&
      this.cacheKey !== undefined &&
      this.initialIterationLimit === solver.MAX_ITERATIONS
    )
  }
}
