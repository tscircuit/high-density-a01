import { expect, test } from "bun:test"
import { defaultA03Params } from "../../lib/default-params"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import sample002 from "../dataset01/sample002/sample002.json"
import sample003 from "../dataset01/sample003/sample003.json"
import sample007 from "../dataset01/sample007/sample007.json"
import prevNext from "../prev-next/prev-next.json"
import repro03 from "../repros/repro03/repro03.json"
import repro05 from "../repros/repro05/repro05.json"

const state = (solver: HighDensitySolverA03): string => {
  const internal = solver as any
  return JSON.stringify({
    iterations: solver.iterations,
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    progress: solver.progress,
    openSet: solver.openSet,
    activeConnection: solver.activeConnection,
    unsolved: solver.unsolvedConnections,
    searchIterations: internal.searchIterations,
    consecutiveSkips: internal.consecutiveSkips,
    ripCount: internal.ripCount,
    rips: internal.totalRipEvents,
  })
}

test("A03 native single pops and bounded quanta preserve complete fixture outcomes and public steps", () => {
  let nativeSteps = 0
  let batchedSteps = 0
  for (const fixture of [
    sample002,
    sample003,
    sample007,
    prevNext,
    repro03,
    repro05,
  ]) {
    const data: any = Array.isArray(fixture) ? fixture[0] : fixture
    const node = data.nodeWithPortPoints ?? data
    const reference = new HighDensitySolverA03({
      ...defaultA03Params,
      nodeWithPortPoints: structuredClone(node),
    })
    const single = new HighDensitySolverA03({
      ...defaultA03Params,
      nodeWithPortPoints: structuredClone(node),
      useNativeSearch: true,
    })
    const batch = new HighDensitySolverA03({
      ...defaultA03Params,
      nodeWithPortPoints: structuredClone(node),
      useNativeSearch: true,
    })
    for (const solver of [reference, single, batch]) {
      solver.setup()
      solver.MAX_ITERATIONS = 250000
    }
    let quantum = 0
    while (!reference.solved && !reference.failed) {
      const count = [1, 2, 99, 100, 101, 7][quantum++ % 6]!
      for (let i = 0; i < count; i++) {
        reference.step()
        single.step()
        expect(state(single)).toBe(state(reference))
      }
      for (let i = 0; i < count; ) {
        const completed = batch.stepNativeBatch(count - i)
        if (completed === 0) {
          batch.step()
          i++
        } else i += completed
      }
      expect(state(batch)).toBe(state(reference))
      if (quantum % 41 === 0 || reference.solved || reference.failed) {
        expect(batch.getOutput()).toEqual(reference.getOutput())
        expect(single.getOutput()).toEqual(reference.getOutput())
        expect(batch.visualize()).toEqual(reference.visualize())
        expect(single.visualize()).toEqual(reference.visualize())
      }
    }
    expect(single.nativeSearchSteps).toBeGreaterThan(0)
    expect(batch.nativeSearchBatchedSteps).toBeGreaterThan(0)
    expect(single.nativeSearchActive).toBe(false)
    expect(batch.nativeSearchActive).toBe(false)
    expect(batch.nativeSearchSteps).toBe(single.nativeSearchSteps)
    nativeSteps += single.nativeSearchSteps
    batchedSteps += batch.nativeSearchBatchedSteps
  }
  expect(nativeSteps).toBeGreaterThan(100000)
  expect(batchedSteps).toBeGreaterThan(100000)
})
