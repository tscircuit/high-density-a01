import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { defaultA03Params } from "../../lib/default-params"
import sample003 from "../dataset01/sample003/sample003.json"

const snapshot = (s: any): string =>
  JSON.stringify({
    solved: s.solved,
    failed: s.failed,
    error: s.error,
    iterations: s.iterations,
    openSet: s.openSet,
    active: s.activeConnection,
    search: s.searchIterations,
    rips: s.totalRipEvents,
    ripCount: s.ripCount,
    output: s.getOutput(),
    calls: s.testCalls,
  })
const create = (native: boolean): any =>
  new HighDensitySolverA03({
    ...defaultA03Params,
    nodeWithPortPoints: structuredClone(sample003),
    useNativeSearch: native,
  })

test("native A03 synchronizes live public geometry and permanently materializes before custom search callbacks", () => {
  const cases: Array<{
    name: string
    deopts: boolean
    edit: (s: any) => void
  }> = [
    {
      name: "centers",
      deopts: false,
      edit: (s) => {
        s.cellCenterX[1] += 0.00001
        s.cellCenterY[2] -= 0.00003
      },
    },
    {
      name: "edges",
      deopts: false,
      edit: (s) => {
        for (let i = 0; i < s.neighborCosts.length; i++)
          s.neighborCosts[i] *= 1.01
      },
    },
    {
      name: "via flags",
      deopts: false,
      edit: (s) => {
        s.viaAllowed.fill(0)
      },
    },
    {
      name: "array replacement",
      deopts: false,
      edit: (s) => {
        s.cellCenterX = s.cellCenterX.slice()
        s.cellCenterY = s.cellCenterY.slice()
        s.neighborIds = s.neighborIds.slice()
      },
    },
    {
      name: "costs",
      deopts: false,
      edit: (s) => {
        s.hyperParameters.viaBaseCost = -0
        s.hyperParameters.ripCost = 0
        s.hyperParameters.greedyMultiplier = 0.75
        s.penaltyCap = Infinity
      },
    },
    {
      name: "nonfinite costs",
      deopts: false,
      edit: (s) => {
        s.hyperParameters.greedyMultiplier = NaN
        s.hyperParameters.viaBaseCost = Infinity
        s.penaltyCap = -Infinity
      },
    },
    {
      name: "CSR resize",
      deopts: true,
      edit: (s) => {
        const n = s.neighborIds.length
        s.neighborIds = new Int32Array(n + 1)
        s.neighborCosts = new Float32Array(n + 1)
        s.neighborOffset.fill(0)
      },
    },
    {
      name: "DataView replacement",
      deopts: true,
      edit: (s) => {
        s.neighborIds = new DataView(new ArrayBuffer(s.neighborIds.byteLength))
      },
    },
    {
      name: "future footprint domain",
      deopts: true,
      edit: (s) => {
        s.regions[0] = { ...s.regions[0], cellScale: 0.5 }
      },
    },
    ...[
      "computeH",
      "computeMoveCostAndRips",
      "getViaOccupants",
      "getViaFootprint",
      "getSearchStateIdx",
    ].map((name) => ({
      name,
      deopts: true,
      edit: (s: any): void => {
        const original = s[name]
        s.testCalls = 0
        s[name] = function (...args: any[]): unknown {
          this.testCalls++
          return Reflect.apply(original, this, args)
        }
      },
    })),
    {
      name: "heap callback",
      deopts: true,
      edit: (s) => {
        const original = s.heap.pop
        s.testCalls = 0
        s.heap.pop = function (): number {
          s.testCalls++
          return Reflect.apply(original, this, [])
        }
      },
    },
    {
      name: "cost getter",
      deopts: true,
      edit: (s) => {
        const value = s.hyperParameters.ripCost
        s.testCalls = 0
        Object.defineProperty(s.hyperParameters, "ripCost", {
          get() {
            s.testCalls++
            return value
          },
          configurable: true,
        })
      },
    },
  ]
  for (const control of cases) {
    const js = create(false),
      native = create(true)
    for (let i = 0; i < 20; i++) {
      js.step()
      native.step()
      expect(snapshot(native)).toBe(snapshot(js))
    }
    expect(native.nativeSearchSteps).toBeGreaterThan(0)
    control.edit(js)
    control.edit(native)
    for (let i = 0; i < 160 && !js.solved && !js.failed; i++) {
      let a = "",
        b = ""
      try {
        js.step()
      } catch (error) {
        a = String(error)
      }
      try {
        native.step()
      } catch (error) {
        b = String(error)
      }
      expect(b).toBe(a)
      expect(snapshot(native)).toBe(snapshot(js))
      if (a) break
    }
    if (control.deopts) {
      expect(native.nativeSearchActive).toBe(false)
      expect(native.nativeDeclined).toBe(true)
    }
  }
})
