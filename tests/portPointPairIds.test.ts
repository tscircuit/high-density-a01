import { expect, test } from "bun:test"
import {
  defaultA08Params,
  defaultA09Params,
  defaultParams,
} from "../lib/default-params"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA08BreakoutSolver } from "../lib/HighDensitySolverA08/HighDensitySolverA08"
import { HighDensitySolverA09 } from "../lib/HighDensitySolverA09/HighDensitySolverA09"
import {
  getNodePortPointPairs,
  getPortPointPairIdsForSubset,
} from "../lib/nodeWithPortPointPairs"
import type { NodeWithPortPoints } from "../lib/types"

const pairedNode: NodeWithPortPoints = {
  capacityMeshNodeId: "pair-ids-repro",
  center: { x: 0, y: 0 },
  width: 12,
  height: 8,
  availableZ: [0],
  portPointPairIds: [
    ["left-low", "right-low"],
    ["left-high", "right-high"],
    ["top", "bottom"],
  ],
  portPoints: [
    {
      connectionName: "conn-horizontal",
      rootConnectionName: "conn-horizontal",
      portPointId: "left-low",
      x: -6,
      y: -2,
      z: 0,
    },
    {
      connectionName: "conn-horizontal",
      rootConnectionName: "conn-horizontal",
      portPointId: "left-high",
      x: -6,
      y: 2,
      z: 0,
    },
    {
      connectionName: "conn-horizontal",
      rootConnectionName: "conn-horizontal",
      portPointId: "right-low",
      x: 6,
      y: -2,
      z: 0,
    },
    {
      connectionName: "conn-horizontal",
      rootConnectionName: "conn-horizontal",
      portPointId: "right-high",
      x: 6,
      y: 2,
      z: 0,
    },
    {
      connectionName: "conn-vertical",
      rootConnectionName: "conn-vertical",
      portPointId: "top",
      x: 0,
      y: 4,
      z: 0,
    },
    {
      connectionName: "conn-vertical",
      rootConnectionName: "conn-vertical",
      portPointId: "bottom",
      x: 0,
      y: -4,
      z: 0,
    },
  ],
}

test("getNodePortPointPairs prefers explicit portPointPairIds", () => {
  const pairs = getNodePortPointPairs(pairedNode).map((pair) => [
    pair.start.portPointId,
    pair.end.portPointId,
  ])

  expect(pairs).toEqual([
    ["left-low", "right-low"],
    ["left-high", "right-high"],
    ["top", "bottom"],
  ])
})

test("A01 setup uses portPointPairIds when building segments", () => {
  const solver = new HighDensitySolverA01({
    ...defaultParams,
    nodeWithPortPoints: pairedNode,
    cellSizeMm: 1,
  })

  solver.setup()

  const unsolvedSegs = (solver as any).unsolvedSegs as Array<{
    startPoint: { x: number; y: number }
    endPoint: { x: number; y: number }
  }>

  const segments = unsolvedSegs
    .map(
      (seg) =>
        `${seg.startPoint.x},${seg.startPoint.y}->${seg.endPoint.x},${seg.endPoint.y}`,
    )
    .sort()

  expect(segments).toEqual(["-6,-2->6,-2", "-6,2->6,2", "0,4->0,-4"])
})

test("A09 subproblems keep only relevant portPointPairIds", () => {
  const solver = new HighDensitySolverA09({
    ...defaultA09Params,
    nodeWithPortPoints: pairedNode,
  })

  solver.setup()

  const horizontalConnection = (
    (solver as any).connections as Array<{
      connectionName: string
      portPoints: NodeWithPortPoints["portPoints"]
    }>
  ).find((connection) => connection.connectionName === "conn-horizontal")

  expect(horizontalConnection).toBeDefined()

  const subproblem = (solver as any).makeSubproblem(horizontalConnection)

  expect(subproblem.portPointPairIds).toEqual([
    ["left-low", "right-low"],
    ["left-high", "right-high"],
  ])
})

test("getPortPointPairIdsForSubset filters pair ids by selected points", () => {
  const filteredPairIds = getPortPointPairIdsForSubset(
    pairedNode,
    pairedNode.portPoints.filter(
      (portPoint) => portPoint.connectionName === "conn-vertical",
    ),
  )

  expect(filteredPairIds).toEqual([["top", "bottom"]])
})

test("A08 breakout preserves portPointPairIds on the inner node", () => {
  const solver = new HighDensitySolverA08BreakoutSolver({
    ...defaultA08Params,
    nodeWithPortPoints: {
      capacityMeshNodeId: "a08-pair-ids",
      center: { x: 0, y: 0 },
      width: 10,
      height: 10,
      availableZ: [0],
      portPointPairIds: [["left", "right"]],
      portPoints: [
        {
          connectionName: "conn00",
          rootConnectionName: "conn00",
          portPointId: "left",
          x: -5,
          y: 0,
          z: 0,
        },
        {
          connectionName: "conn00",
          rootConnectionName: "conn00",
          portPointId: "right",
          x: 5,
          y: 0,
          z: 0,
        },
      ],
    },
  })

  solver.MAX_ITERATIONS = 10_000
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.innerNodeWithPortPoints?.portPointPairIds).toEqual([
    ["left", "right"],
  ])
})
