import { expect, test } from "bun:test"
import { isDeepStrictEqual } from "node:util"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { FrozenHighDensitySolverA01 } from "../fixtures/frozen-a01-object-node-pool-solver"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

function state(solver: any): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const name of Object.getOwnPropertyNames(solver)) {
    if (name === "heuristicCache") continue
    result[name] = name === "heap" ? { ...solver[name] } : solver[name]
  }
  result.output = solver.getOutput()
  result.activeConnection = solver.activeConnection
  result.openSet = solver.openSet
  return result
}

function pair() {
  const props = {
    nodeWithPortPoints: viaOccupantCacheNode,
    cellSizeMm: 0.1,
    stepMultiplier: 1000,
    viaDiameter: 0.3,
    traceMargin: 0.1,
    traceThickness: 0.1,
    hyperParameters: { shuffleSeed: 1 },
  }
  return {
    actual: new HighDensitySolverA01(structuredClone(props)) as any,
    reference: new FrozenHighDensitySolverA01(structuredClone(props)) as any,
  }
}

function stepPair(actual: any, reference: any) {
  actual.solvedConnectionsMap
  reference.solvedConnectionsMap
  actual.step()
  reference.step()
  expect(isDeepStrictEqual(state(actual), state(reference))).toBeTrue()
}

function pairWithRoute() {
  const { actual, reference } = pair()
  for (let index = 0; index < 10; index++) {
    stepPair(actual, reference)
    if (actual.solvedConnectionsMap.size > 0) return { actual, reference }
    if (actual.solved || actual.failed) break
  }
  throw new Error("fixture must expose a native solved route")
}

test("native escaped route maps retain exact public-step state", () => {
  const { actual, reference } = pairWithRoute()
  let cacheSteps = 0
  for (
    let index = 0;
    index < 5 && !reference.solved && !reference.failed;
    index++
  ) {
    // Ordinary primitive edits to native records remain safe to inspect.
    for (const routes of actual.solvedConnectionsMap.values()) {
      for (const route of routes) route.startRow += 0
    }
    for (const routes of reference.solvedConnectionsMap.values()) {
      for (const route of routes) route.startRow += 0
    }
    stepPair(actual, reference)
    if (actual.heuristicCache) cacheSteps++
  }
  expect(cacheSteps).toBeGreaterThan(0)
  expect(actual.getOutput()).toEqual(reference.getOutput())
  actual.releaseHeuristicCache()
})

test("escaped native route accessors use original conditional reads", () => {
  const { actual, reference } = pairWithRoute()
  const actualRoute = actual.solvedConnectionsMap.values().next().value[0]
  const referenceRoute = reference.solvedConnectionsMap.values().next().value[0]
  const calls = [0, 0]
  for (const [index, solver, route] of [
    [0, actual, actualRoute],
    [1, reference, referenceRoute],
  ] as const) {
    const endRow = route.endRow
    Object.defineProperty(route, "endRow", {
      configurable: true,
      get() {
        calls[index] = calls[index]! + 1
        solver.hyperParameters.viaBaseCost = 0.2 + calls[index]! / 1000
        return endRow
      },
    })
  }
  expect(actual.getHeuristicCacheForStep()).toBeUndefined()
  expect(calls).toEqual([0, 0])
  for (
    let index = 0;
    index < 5 && !reference.solved && !reference.failed;
    index++
  ) {
    stepPair(actual, reference)
    expect(calls[0]).toBe(calls[1])
    expect(actual.heuristicCache).toBeUndefined()
  }
})

test("foreign map replacements and hooks are rejected without new callbacks", () => {
  const { actual } = pairWithRoute()
  const map = actual.solvedConnectionsMap
  const [id, routes] = map.entries().next().value
  const route = routes[0]
  let traps = 0
  const handler = {
    get() {
      traps++
      throw new Error("unexpected Proxy access")
    },
    getPrototypeOf() {
      traps++
      throw new Error("unexpected Proxy introspection")
    },
    ownKeys() {
      traps++
      throw new Error("unexpected Proxy enumeration")
    },
  }
  map.set(id, new Proxy(routes, handler))
  expect(actual.getHeuristicCacheForStep()).toBeUndefined()
  expect(traps).toBe(0)
  map.set(id, routes)
  routes[0] = new Proxy(route, handler)
  expect(actual.getHeuristicCacheForStep()).toBeUndefined()
  expect(traps).toBe(0)
  routes[0] = route
  const cells = route.cells
  route.cells = new Proxy(cells, handler)
  expect(actual.getHeuristicCacheForStep()).toBeUndefined()
  expect(traps).toBe(0)
  route.cells = cells
  route.cells[0] = new Proxy(cells[0], handler)
  expect(actual.getHeuristicCacheForStep()).toBeUndefined()
  expect(traps).toBe(0)
  map.set(id, [...routes])
  expect(actual.getHeuristicCacheForStep()).toBeUndefined()
  map.set(id, routes)
  let getCalls = 0
  Object.defineProperty(map, "get", {
    configurable: true,
    get() {
      getCalls++
      return Map.prototype.get
    },
  })
  expect(actual.getHeuristicCacheForStep()).toBeUndefined()
  expect(getCalls).toBe(0)
  Reflect.deleteProperty(map, "get")
})

test("exposing mutable unsolved segments permanently keeps ordinary dispatch", () => {
  const { actual, reference } = pair()
  actual.setup()
  reference.setup()
  expect(actual.unsolvedConnections).toBe(actual.unsolvedSegs)
  expect(actual.getHeuristicCacheForStep()).toBeUndefined()
  for (let index = 0; index < 2; index++) stepPair(actual, reference)
  expect(actual.heuristicCache).toBeUndefined()
})

test("indirect public getter receivers mark the actual exposed containers", () => {
  const { actual, reference } = pair()
  expect(actual.solvedConnectionsMap).toBeUndefined()
  expect(actual.unsolvedConnections).toBeUndefined()
  actual.setup()
  reference.setup()
  const proxy = new Proxy(actual, {})
  expect(proxy.unsolvedConnections).toBe(actual.unsolvedSegs)
  expect(actual.getHeuristicCacheForStep()).toBeUndefined()

  const withRoute = pairWithRoute().actual
  const indirect = Object.create(withRoute)
  const map = indirect.solvedConnectionsMap
  const [id, routes] = map.entries().next().value
  let traps = 0
  map.set(
    id,
    new Proxy(routes, {
      getPrototypeOf() {
        traps++
        throw new Error("unexpected introspection")
      },
      ownKeys() {
        traps++
        throw new Error("unexpected enumeration")
      },
    }),
  )
  expect(withRoute.getHeuristicCacheForStep()).toBeUndefined()
  expect(traps).toBe(0)
})

test("public maps sharing an empty native array remain bounded", () => {
  const actual = pairWithRoute().actual
  const map = actual.solvedConnectionsMap
  const routes = map.values().next().value
  routes.length = 0
  map.clear()
  for (let index = 0; index <= 262_144; index++) map.set(index, routes)
  expect(actual.getHeuristicCacheForStep()).toBeUndefined()
  actual.releaseHeuristicCache()
})
