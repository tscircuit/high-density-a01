// Frozen from 3701effa; only the this annotation and prototype typing adapt the test context.
import { BaseSolver } from "@tscircuit/solver-utils"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"

export function frozenStepNativeBatch(this: any, maxSteps: number): number {
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) return 0
  // Inspect descriptors first: checking a getter's value would already change
  // the conditional read counts of the ordinary step path.
  const ownData = (name: string, writable = false): boolean => {
    const descriptor = Object.getOwnPropertyDescriptor(this, name)
    return (
      !!descriptor &&
      "value" in descriptor &&
      (!writable || descriptor.writable === true)
    )
  }
  for (const name of [
    "iterations",
    "searchIterations",
    "nativeStepCount",
    "nativeBatchedStepCount",
    "nativeOpenSetLength",
    "failed",
    "error",
  ]) {
    if (!ownData(name, true)) return 0
  }
  for (const name of [
    "_setupDone",
    "solved",
    "MAX_ITERATIONS",
    "stepMultiplier",
    "searchBudgetIters",
    "nativeSearchForActiveConnection",
    "nativeSearchKernel",
    "hyperParameters",
    "cellSizeMm",
    "penaltyCap",
  ]) {
    if (!ownData(name)) return 0
  }
  const dataProperty = (object: object, name: string): boolean => {
    for (
      let current: object | null = object;
      current;
      current = Object.getPrototypeOf(current)
    ) {
      const descriptor = Object.getOwnPropertyDescriptor(current, name)
      if (descriptor) return "value" in descriptor
    }
    return false
  }
  for (const name of [
    "step",
    "_step",
    "stepOnce",
    "advanceNativeSearch",
    "tryFinalAcceptance",
  ]) {
    if (!dataProperty(this, name)) return 0
  }
  const original = HighDensitySolverA01.prototype as any
  if (
    this.step !== BaseSolver.prototype.step ||
    this._step !== original._step ||
    this.stepOnce !== original.stepOnce ||
    this.advanceNativeSearch !== original.advanceNativeSearch ||
    this.tryFinalAcceptance !== BaseSolver.prototype.tryFinalAcceptance ||
    "computeProgress" in this ||
    !this._setupDone ||
    this.solved ||
    this.failed ||
    this.stepMultiplier !== 1 ||
    !this.nativeSearchForActiveConnection ||
    !this.nativeSearchKernel
  )
    return 0
  const hp = this.hyperParameters
  for (const name of [
    "viaBaseCost",
    "ripCost",
    "ripTracePenalty",
    "ripViaPenalty",
    "greedyMultiplier",
  ]) {
    if (!dataProperty(hp, name)) return 0
  }
  // Non-number values can invoke user coercion callbacks or throw at the
  // WASM boundary. Preserve their per-step conversion on the ordinary path.
  if (
    typeof this.cellSizeMm !== "number" ||
    typeof this.penaltyCap !== "number" ||
    typeof hp.viaBaseCost !== "number" ||
    typeof hp.ripCost !== "number" ||
    typeof hp.ripTracePenalty !== "number" ||
    typeof hp.ripViaPenalty !== "number" ||
    typeof hp.greedyMultiplier !== "number"
  )
    return 0
  for (const value of [
    this.iterations,
    this.MAX_ITERATIONS,
    this.searchIterations,
    this.searchBudgetIters,
    this.nativeStepCount,
    this.nativeBatchedStepCount,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) return 0
  }
  const limit = Math.min(
    maxSteps,
    0xffff_ffff,
    this.MAX_ITERATIONS - this.iterations - 1,
    this.searchBudgetIters - this.searchIterations,
    Number.MAX_SAFE_INTEGER - this.nativeStepCount,
    Number.MAX_SAFE_INTEGER - this.nativeBatchedStepCount,
  )
  if (limit < 1) return 0
  const kernel = this.nativeSearchKernel
  let completed: number
  try {
    completed = kernel.advanceMany(limit, this.cellSizeMm, hp, this.penaltyCap)
  } catch (error) {
    // BaseSolver increments before _step; a throwing native advance does not
    // increment nativeStepCount or publish its partially changed heap length.
    this.iterations += kernel.lastBatchAttempts
    this.searchIterations += kernel.lastBatchAttempts
    this.nativeStepCount += kernel.lastBatchCompleted
    this.nativeBatchedStepCount += kernel.lastBatchCompleted
    this.nativeOpenSetLength = kernel.heapSize
    this.error = `${this.getSolverName()} error: ${error}`
    this.failed = true
    throw error
  }
  this.iterations += completed
  this.searchIterations += completed
  this.nativeStepCount += completed
  this.nativeBatchedStepCount += completed
  this.nativeOpenSetLength = kernel.heapSize
  return completed
}
