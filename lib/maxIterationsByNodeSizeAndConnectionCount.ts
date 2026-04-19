export interface MaxIterationsByNodeSizeAndConnectionCountInput {
  planeSize: number
  layers: number
  connectionCount: number
  effort: number
  maxIterations: number
  minimumIterationBudget?: number
  minimumBaseSearchBudget?: number
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
  const states = input.planeSize * input.layers
  const connectionCount = input.connectionCount
  const connectionFactor = Math.sqrt(connectionCount)
  const requestedMaxIterations = Math.max(1, input.maxIterations)

  const baseComputedMaxIterations = clamp(
    Math.round(states * (8 + 1.2 * connectionFactor)),
    150_000,
    12_000_000,
  )
  const computedMaxIters = clamp(
    Math.round(baseComputedMaxIterations * input.effort),
    150_000,
    12_000_000,
  )
  const minIterationBudgetIters = clamp(
    Math.round(requestedMaxIterations * 0.2),
    150_000,
    2_000_000,
  )
  const requestedMinimumIterationBudget = Math.max(
    0,
    Math.floor(input.minimumIterationBudget ?? 0),
  )
  const maxIterationsIters = Math.max(
    1,
    Math.min(
      requestedMaxIterations,
      Math.max(minIterationBudgetIters, requestedMinimumIterationBudget, computedMaxIters),
    ),
  )
  const computedBaseSearchBudgetIters = clamp(
    Math.round(states * (10 + 0.8 * connectionFactor) * input.effort),
    50_000,
    4_000_000,
  )
  const requestedMinimumBaseSearchBudget = Math.max(
    0,
    Math.floor(input.minimumBaseSearchBudget ?? 0),
  )
  const baseSearchBudgetIters = Math.max(
    computedBaseSearchBudgetIters,
    requestedMinimumBaseSearchBudget,
  )

  return {
    maxIterationsIters,
    baseSearchBudgetIters,
  }
}
