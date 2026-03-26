export interface MaxIterationsByNodeSizeAndConnectionCountInput {
  planeSize: number
  layers: number
  connectionCount: number
  effort: number
  maxIterations: number
}

export interface MaxIterationsByNodeSizeAndConnectionCountResult {
  maxIterationsIters: number
  baseSearchBudgetIters: number
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function computeMaxIterationsByNodeSizeAndConnectionCount(
  input: MaxIterationsByNodeSizeAndConnectionCountInput,
): MaxIterationsByNodeSizeAndConnectionCountResult {
  const states = Math.max(1, input.planeSize * input.layers)
  const connectionCount = Math.max(0, input.connectionCount)
  const connectionFactor = Math.sqrt(connectionCount)
  const effortMultiplier =
    Number.isFinite(input.effort) && input.effort > 0 ? input.effort : 1
  const requestedMaxIterations = Math.max(1, input.maxIterations)

  const baseComputedMaxIterations = clamp(
    Math.round(states * (8 + 1.2 * connectionFactor)),
    150_000,
    12_000_000,
  )
  const computedMaxIters = clamp(
    Math.round(baseComputedMaxIterations * effortMultiplier),
    150_000,
    12_000_000,
  )
  const minIterationBudgetIters = clamp(
    Math.round(requestedMaxIterations * 0.2),
    150_000,
    2_000_000,
  )
  const maxIterationsIters = Math.max(
    1,
    Math.min(
      requestedMaxIterations,
      Math.max(minIterationBudgetIters, computedMaxIters),
    ),
  )
  const baseSearchBudgetIters = clamp(
    Math.round(states * (10 + 0.8 * connectionFactor) * effortMultiplier),
    50_000,
    4_000_000,
  )

  return {
    maxIterationsIters,
    baseSearchBudgetIters,
  }
}
