import { expect, test } from "bun:test"
import { HighDensitySolverA13, findRouteGeometryViolations } from "../../lib"
import hardNode from "../../fixtures/srj18/cmn_4__sub_2_0.json"

const smallNode = {
  capacityMeshNodeId: "backend-equivalence",
  center: { x: 0, y: 0 },
  width: 2,
  height: 2,
  availableZ: [1, 3, 7],
  portPoints: [
    { connectionName: "a", x: -1, y: 0, z: 1 },
    { connectionName: "a", x: 1, y: 0, z: 7 },
    { connectionName: "b", x: 0, y: -1, z: 3 },
    { connectionName: "b", x: 0, y: 1, z: 3 },
  ],
}

for (const stepMultiplier of [1, 7.5, 1000])
  for (const maxSearchIterations of [1, 13.5, 10000])
    test(`search backends agree at each debugger step (step=${stepMultiplier}, budget=${maxSearchIterations})`, () => {
      const props = {
        nodeWithPortPoints: smallNode,
        stepMultiplier,
        maxSearchIterations,
        maxRounds: 3,
      }
      const js = new HighDensitySolverA13({
        ...props,
        searchBackend: "javascript",
      })
      const wasm = new HighDensitySolverA13({ ...props, searchBackend: "wasm" })
      while (!js.solved && !js.failed) {
        js.step()
        wasm.step()
        for (const key of [
          "solved",
          "failed",
          "error",
          "phase",
          "round",
          "routingIterations",
          "routedCount",
          "rerouteCount",
          "activeConnectionIndex",
        ] as const)
          expect(wasm[key], key).toEqual(js[key])
      }
      expect(wasm.getOutput()).toEqual(js.getOutput())
      expect(wasm.violations).toEqual(js.violations)
    })

test("hard-node backends preserve provisional routes and cached violation ordering", () => {
  const js = new HighDensitySolverA13({
    nodeWithPortPoints: hardNode,
    searchBackend: "javascript",
  })
  const wasm = new HighDensitySolverA13({
    nodeWithPortPoints: hardNode,
    searchBackend: "wasm",
  })
  let round = 0,
    reroutes = -1,
    routedCount = -1
  while (!js.solved && !js.failed) {
    js.step()
    wasm.step()
    expect(wasm.routingIterations).toBe(js.routingIterations)
    expect(wasm.phase).toBe(js.phase)
    if (js.rerouteCount !== reroutes || js.routedCount !== routedCount) {
      reroutes = js.rerouteCount
      routedCount = js.routedCount
      expect(wasm.getOutput()).toEqual(js.getOutput())
    }
    if (js.round !== round) {
      round = js.round
      const exact = findRouteGeometryViolations(
        js.getOutput().map((route) => ({
          ...route,
          traceThickness: route.traceThickness + 0.1,
          viaDiameter: route.viaDiameter + 0.1,
        })),
      )
      expect(js.violations).toEqual(exact)
      expect(wasm.violations).toEqual(exact)
    }
  }
  expect(js.solved).toBe(true)
  expect(wasm.solved).toBe(true)
}, 30_000)

test("both backends report an exhausted frontier when no layer transition fits", () => {
  const solvers = (["javascript", "wasm"] as const).map(
    (searchBackend) =>
      new HighDensitySolverA13({
        nodeWithPortPoints: smallNode,
        searchBackend,
        viaMinDistFromBorder: 2,
      }),
  )
  for (const solver of solvers) solver.solve()
  expect(solvers[0]!.failed).toBe(true)
  expect(solvers[1]!.error).toBe(solvers[0]!.error)
  expect(solvers[1]!.routingIterations).toBe(solvers[0]!.routingIterations)
  expect(solvers[1]!.getOutput()).toEqual(solvers[0]!.getOutput())
})

test("auto uses JavaScript without attempting WebAssembly initialization", () => {
  let attempts = 0
  const OriginalInstance = WebAssembly.Instance
  WebAssembly.Instance = class {
    readonly exports!: WebAssembly.Exports
    constructor() {
      attempts++
      throw new WebAssembly.CompileError(
        "WebAssembly blocked for fallback test",
      )
    }
  }
  try {
    const auto = new HighDensitySolverA13({ nodeWithPortPoints: smallNode })
    const js = new HighDensitySolverA13({
      nodeWithPortPoints: smallNode,
      searchBackend: "javascript",
    })
    auto.solve()
    js.solve()
    expect(auto.solved).toBe(true)
    expect(auto.getOutput()).toEqual(js.getOutput())
    expect(auto.routingIterations).toBe(js.routingIterations)
    expect(attempts).toBe(0)
    const forced = new HighDensitySolverA13({
      nodeWithPortPoints: smallNode,
      searchBackend: "wasm",
    })
    expect(() => forced.solve()).toThrow("WebAssembly blocked")
  } finally {
    WebAssembly.Instance = OriginalInstance
  }
})
