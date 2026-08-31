import {
  HighDensitySolverA11,
  type HighDensitySolverA11Props,
} from "../HighDensitySolverA11/HighDensitySolverA11"

export type HighDensitySolverA13Props = HighDensitySolverA11Props

/**
 * A11 with history-aware rip costs. Repeatedly displacing the same route gets
 * progressively more expensive, which breaks otherwise stable rip cycles.
 */
export class HighDensitySolverA13 extends HighDensitySolverA11 {
  protected override ripHistoryCostMultiplier = 1

  override getSolverName(): string {
    return "HighDensitySolverA13"
  }
}
