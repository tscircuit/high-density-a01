import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { defaultA03Params } from "../../lib/default-params"
import sample003 from "../dataset01/sample003/sample003.json"

const create = (native: boolean): any =>
  new HighDensitySolverA03({
    ...defaultA03Params,
    nodeWithPortPoints: structuredClone(sample003),
    useNativeSearch: native,
  })
const snapshot = (s: any): string =>
  JSON.stringify({
    iterations: s.iterations,
    solved: s.solved,
    failed: s.failed,
    error: s.error,
    progress: s.progress,
    openSet: s.openSet,
    search: s.searchIterations,
    skips: s.consecutiveSkips,
    active: s.activeConnection,
    unsolved: s.unsolvedConnections,
    output: s.getOutput(),
    calls: s.testCalls,
  })

test("native A03 preserves budget, MAX, finalizer and scheduler boundaries without bypassing callbacks", () => {
  const cases: Array<{ name: string; edit: (s: any) => void }> = [
    {
      name: "budget",
      edit: (s) => {
        s.baseSearchBudgetIters = 3
      },
    },
    {
      name: "global limit",
      edit: (s) => {
        s.MAX_ITERATIONS = 37
      },
    },
    {
      name: "step multiplier",
      edit: (s) => {
        s.stepMultiplier = 3
      },
    },
    {
      name: "progress callback",
      edit: (s) => {
        s.testCalls = 0
        s.computeProgress = function (): number {
          this.testCalls++
          return this.iterations / 10000
        }
      },
    },
    {
      name: "final acceptance",
      edit: (s) => {
        s.MAX_ITERATIONS = 37
        s.testCalls = 0
        s.tryFinalAcceptance = function (): void {
          this.testCalls++
          this.solved = true
        }
      },
    },
    {
      name: "custom finalizer",
      edit: (s) => {
        const original = s.finalizeRoute
        s.testCalls = 0
        s.finalizeRoute = function (id: number): void {
          this.testCalls++
          expect(this.heap.size).toBe(this.openSet.length)
          Reflect.apply(original, this, [id])
        }
      },
    },
    {
      name: "throwing finalizer",
      edit: (s) => {
        s.finalizeRoute = function (): never {
          throw new Error("test finalizer failure")
        }
      },
    },
    {
      name: "live rip count accessor",
      edit: (s) => {
        s.testCalls = 0
        Object.defineProperty(s.ripCount, String(s.activeConnId), {
          get() {
            s.testCalls++
            return 1
          },
          configurable: true,
        })
      },
    },
    {
      name: "coercible budget",
      edit: (s) => {
        s.testCalls = 0
        s.baseSearchBudgetIters = {
          valueOf() {
            s.testCalls++
            return 30
          },
        }
      },
    },
  ]
  for (const control of cases) {
    const js = create(false),
      single = create(true),
      batch = create(true)
    for (let i = 0; i < 20; i++) {
      js.step()
      single.step()
      batch.step()
    }
    expect(single.nativeSearchSteps).toBeGreaterThan(0)
    control.edit(js)
    control.edit(single)
    control.edit(batch)
    const heap = single.heap
    for (let i = 0; i < 300 && !js.solved && !js.failed; ) {
      const count = Math.min(13, 300 - i)
      let expectedError = "",
        singleError = "",
        batchError = ""
      let done = 0
      for (; done < count && !js.solved && !js.failed; done++) {
        try {
          js.step()
        } catch (e) {
          expectedError = String(e)
        }
        try {
          single.step()
        } catch (e) {
          singleError = String(e)
        }
        expect(singleError).toBe(expectedError)
        expect(snapshot(single)).toBe(snapshot(js))
      }
      for (let j = 0; j < done; ) {
        let n = 0
        try {
          n = batch.stepNativeBatch(done - j)
          if (!n) {
            batch.step()
            n = 1
          }
        } catch (e) {
          batchError = String(e)
          n = 1
        }
        j += n
      }
      expect(batchError).toBe(expectedError)
      expect(snapshot(batch)).toBe(snapshot(js))
      expect(single.heap).toBe(heap)
      i += done
    }
    if (js.solved || js.failed) {
      expect(single.nativeSearchActive).toBe(false)
      expect(batch.nativeSearchActive).toBe(false)
    }
  }
  const js = create(false),
    native = create(true)
  for (let i = 0; i < 30; i++) {
    js.step()
    native.step()
  }
  const released = native.nativeKernel
  for (const s of [js, native]) {
    s._setup()
    s.iterations = 0
    s.solved = false
    s.failed = false
    s.error = null
  }
  expect(native.nativeSearchSteps).toBe(0)
  expect(native.nativeSearchActive).toBe(false)
  expect(() => released.advance({})).toThrow()
  for (let i = 0; i < 100; i++) {
    js.step()
    native.step()
    expect(snapshot(native)).toBe(snapshot(js))
  }
  expect(native.nativeSearchSteps).toBeGreaterThan(0)
})
