import { expect, test } from "bun:test"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import type { NodeWithPortPoints } from "../../lib/types"
import { FrozenHighDensitySolverA01 } from "../fixtures/frozen-a01-object-node-pool-solver"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

class CustomRipCostSolver extends HighDensitySolverA01 {
  calls = 0

  protected override getRipCost(connId: number): number {
    this.calls++
    return super.getRipCost(connId) + (connId % 3) * 0.125
  }
}

class FrozenCustomRipCostSolver extends FrozenHighDensitySolverA01 {
  calls = 0

  protected override getRipCost(connId: number): number {
    this.calls++
    return super.getRipCost(connId) + (connId % 3) * 0.125
  }
}

interface RipNode {
  id: number
  prev: RipNode | null
}

function ripIds(ripped: RipNode | null): number[] {
  const ids: number[] = []
  for (let current = ripped; current; current = current.prev) {
    ids.push(current.id)
  }
  return ids
}

test("A01 typed nodes preserve queued values, public steps and rip reconstruction", () => {
  const singleLayerNode: NodeWithPortPoints = {
    ...structuredClone(viaOccupantCacheNode),
    availableZ: [7],
    portPoints: viaOccupantCacheNode.portPoints.map((point, index) => ({
      ...point,
      y: viaOccupantCacheNode.portPoints[index - (index % 2)]!.y,
      z: 7,
    })),
  }
  const cases = [
    { node: viaOccupantCacheNode, seed: 0, stepMultiplier: 1, custom: false },
    { node: viaOccupantCacheNode, seed: 1, stepMultiplier: 1, custom: false },
    { node: viaOccupantCacheNode, seed: 2, stepMultiplier: 5, custom: false },
    { node: viaOccupantCacheNode, seed: 1, stepMultiplier: 3, custom: true },
    { node: singleLayerNode, seed: 0, stepMultiplier: 1, custom: false },
    { node: singleLayerNode, seed: 2, stepMultiplier: 7, custom: true },
  ]
  let observedRips = false
  let comparedNodeCount = 0
  for (const scenario of cases) {
    const props = {
      ...defaultParams,
      nodeWithPortPoints: structuredClone(scenario.node),
      traceMargin: 0.1,
      stepMultiplier: scenario.stepMultiplier,
      hyperParameters: { shuffleSeed: scenario.seed },
    }
    const actual = scenario.custom
      ? new CustomRipCostSolver(props)
      : new HighDensitySolverA01(props)
    const reference = scenario.custom
      ? new FrozenCustomRipCostSolver(structuredClone(props))
      : new FrozenHighDensitySolverA01(structuredClone(props))
    const originalInput = structuredClone(props.nodeWithPortPoints)
    let previousStamp = -1
    let comparedLength = 0
    while (!reference.solved && !reference.failed) {
      if (reference.iterations > 300_000) {
        throw new Error("Frozen test routing exceeded its bounded fixture")
      }
      actual.step()
      reference.step()
      expect([actual.solved, actual.failed, actual.error]).toEqual([
        reference.solved,
        reference.failed,
        reference.error,
      ])
      expect(actual.iterations).toBe(reference.iterations)
      expect(actual.openSet).toEqual(reference.openSet)
      expect(actual.activeConnection).toEqual(reference.activeConnection)
      expect(actual.unsolvedConnections).toEqual(reference.unsolvedConnections)
      const pool = actual["nodePool"]
      const originalPool = reference["nodePool"]
      if (!pool || !originalPool) continue
      expect(pool.length).toBe(originalPool.length)
      if (actual["stamp"] !== previousStamp) {
        previousStamp = actual["stamp"]
        comparedLength = 0
      }
      for (let index = comparedLength; index < pool.length; index++) {
        const node = originalPool[index]!
        for (const key of ["z", "row", "col", "g", "f", "parentIdx"] as const) {
          expect(Object.is(pool[key][index], node[key])).toBeTrue()
        }
        expect(ripIds(pool.ripped[index]!)).toEqual(ripIds(node.ripped))
        comparedNodeCount++
      }
      comparedLength = pool.length
    }
    expect(actual.gridStats).toEqual(reference.gridStats)
    expect(actual.solvedConnectionsMap).toEqual(reference.solvedConnectionsMap)
    expect(actual["ripCount"]).toEqual(reference["ripCount"])
    observedRips ||= actual["ripCount"].some((count) => count > 0)
    expect(actual.getOutput()).toEqual(reference.getOutput())
    expect(actual.nodeWithPortPoints).toEqual(originalInput)
    expect(actual.getConstructorParams()).toEqual(
      reference.getConstructorParams(),
    )
    if (actual instanceof CustomRipCostSolver) {
      expect(actual.calls).toBe((reference as FrozenCustomRipCostSolver).calls)
    }
  }
  expect(observedRips).toBeTrue()
  expect(comparedNodeCount).toBeGreaterThan(1024)

  // Exercise capacity growth with Number values that an integer pool would
  // truncate, and ensure clearing releases rip references and restarts IDs.
  const owner = new HighDensitySolverA01({
    ...defaultParams,
    nodeWithPortPoints: structuredClone(viaOccupantCacheNode),
  })
  owner.step()
  const pool = owner["nodePool"]
  pool.clear()
  const expected = Array.from({ length: 2050 }, (_, index) => ({
    z: 2 ** 40 + index,
    row: -(2 ** 40) + index,
    col: index + 0.125,
    g: index % 3 === 0 ? -0 : index % 3 === 1 ? NaN : Infinity,
    f: index / 7,
    parentIdx: index === 0 ? -1 : index - 1,
    ripped: { id: index, prev: null },
  }))
  for (const [index, node] of expected.entries()) {
    expect(
      pool.push(
        node.z,
        node.row,
        node.col,
        node.g,
        node.f,
        node.parentIdx,
        node.ripped,
      ),
    ).toBe(index)
  }
  for (const [index, node] of expected.entries()) {
    for (const key of ["z", "row", "col", "g", "f", "parentIdx"] as const) {
      expect(Object.is(pool[key][index], node[key])).toBeTrue()
    }
    expect(pool.ripped[index]).toBe(node.ripped)
  }
  pool.clear()
  expect(pool.length).toBe(0)
  expect(pool.ripped.length).toBe(0)
  expect(pool.push(0, 0, 0, 0, 0, -1, null)).toBe(0)
  expect(pool.parentIdx[0]).toBe(-1)
  expect(pool.ripped[0]).toBeNull()
})
