import { expect, test } from "bun:test"
import { getConnectionPortPointPairs } from "../../../lib/getConnectionPortPointPairs"
import { HighDensitySolverA03 } from "../../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { HighDensitySolverA11 } from "../../../lib/HighDensitySolverA11/HighDensitySolverA11"
import { HighDensitySolverA12 } from "../../../lib/HighDensitySolverA12/HighDensitySolverA12"
import { findRouteGeometryViolations } from "../../../lib/routeGeometryValidation"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "../../../lib/types"
import cmn345Sub00 from "../dataset-hd30-a11/sample007-cmn_345__sub_0_0.json"
import cmn345Sub02 from "../dataset-hd30-a11/sample007-cmn_345__sub_0_2.json"
import cmn438 from "../dataset-hd30-a11/sample008-cmn_438.json"
import cmn70 from "./sample003-cmn_70.json"
import topologyMerge639 from "./sample004-topology_merge_639.json"
import cmn45 from "./sample005-cmn_45.json"
import cmn251 from "./sample008-cmn_251.json"
import cmn56 from "./sample011-cmn_56.json"
import cmn119 from "./sample016-cmn_119.json"
import cmn31 from "./sample016-cmn_31.json"

const solverProps = {
  viaDiameter: 0.3,
  viaMinDistFromBorder: 0.15,
  traceMargin: 0.1,
  traceThickness: 0.1,
  effort: 1,
  hyperParameters: { shuffleSeed: 0 },
} as const

const cases: Array<{
  id: string
  nodeWithPortPoints: NodeWithPortPoints
  expectedRouteCount: number
  expectedFineCellSize?: number
  expectedFineGridThickness?: number
  maxExpectedIterations?: number
}> = [
  {
    id: "sample003-cmn_70",
    nodeWithPortPoints: cmn70,
    expectedRouteCount: 5,
  },
  {
    id: "sample004-topology_merge_639",
    nodeWithPortPoints: topologyMerge639,
    expectedRouteCount: 5,
    expectedFineGridThickness: 2,
  },
  { id: "sample005-cmn_45", nodeWithPortPoints: cmn45, expectedRouteCount: 4 },
  {
    id: "sample007-cmn_345__sub_0_0",
    nodeWithPortPoints: cmn345Sub00,
    expectedRouteCount: 2,
  },
  {
    id: "sample007-cmn_345__sub_0_2",
    nodeWithPortPoints: cmn345Sub02,
    expectedRouteCount: 2,
  },
  {
    id: "sample008-cmn_251",
    nodeWithPortPoints: cmn251,
    expectedRouteCount: 5,
  },
  {
    id: "sample008-cmn_438",
    nodeWithPortPoints: cmn438,
    expectedRouteCount: 3,
  },
  {
    id: "sample011-cmn_56",
    nodeWithPortPoints: cmn56,
    expectedRouteCount: 11,
    expectedFineGridThickness: 2,
    maxExpectedIterations: 15_000,
  },
  {
    id: "sample016-cmn_119",
    nodeWithPortPoints: cmn119,
    expectedRouteCount: 6,
    expectedFineCellSize: 0.025,
    maxExpectedIterations: 15_000,
  },
  { id: "sample016-cmn_31", nodeWithPortPoints: cmn31, expectedRouteCount: 3 },
]

function physicalPairKey(
  start: { x: number; y: number; z: number },
  end: { x: number; y: number; z: number },
) {
  return [start, end]
    .map((point) => `${point.x},${point.y},${point.z}`)
    .sort()
    .join("|")
}

function isSamePoint(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
) {
  return left.x === right.x && left.y === right.y && left.z === right.z
}

test("A03 diagonal edges remain opt-in", () => {
  const commonProps = {
    ...solverProps,
    nodeWithPortPoints: cmn70,
    highResolutionCellSize: 0.05,
    highResolutionCellThickness: 16,
    lowResolutionCellSize: 0.2,
  }
  const defaultSolver = new HighDensitySolverA03(commonProps)
  const explicitFourNeighborSolver = new HighDensitySolverA03({
    ...commonProps,
    enableDiagonalMoves: false,
  })
  const diagonalSolver = new HighDensitySolverA03({
    ...commonProps,
    enableDiagonalMoves: true,
  })

  defaultSolver.setup()
  explicitFourNeighborSolver.setup()
  diagonalSolver.setup()

  expect(defaultSolver.enableDiagonalMoves).toBeFalse()
  expect(defaultSolver.neighborIds).toEqual(
    explicitFourNeighborSolver.neighborIds,
  )
  expect(diagonalSolver.neighborIds.length).toBeGreaterThan(
    defaultSolver.neighborIds.length,
  )
})

test("A12 allows the fine perimeter thickness to be tuned", () => {
  const solver = new HighDensitySolverA12({
    ...solverProps,
    nodeWithPortPoints: cmn70,
    fineGridCellThickness: 3,
  })

  solver.setup()

  expect(solver.highResolutionCellThickness).toBe(3)
  expect(solver.highResolutionCellSize).toBeCloseTo(0.05, 12)
  expect(solver.lowResolutionCellSize).toBeCloseTo(0.2, 12)
})

test("A12 reports reproducible mixed-grid constructor parameters", () => {
  const solver = new HighDensitySolverA12({
    ...solverProps,
    nodeWithPortPoints: cmn70,
    fineGridCellThickness: 8,
  })

  const [constructorProps] = solver.getConstructorParams()
  expect(constructorProps.fineGridCellThickness).toBe(8)
  expect("highResolutionCellSize" in constructorProps).toBeFalse()
  expect("highResolutionCellThickness" in constructorProps).toBeFalse()
  expect("lowResolutionCellSize" in constructorProps).toBeFalse()
  expect("enableDiagonalMoves" in constructorProps).toBeFalse()
})

test("A12 keeps the mixed grid connected while reducing large-node states", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "large-mixed-grid",
    center: { x: 0, y: 0 },
    width: 10.03,
    height: 10,
    availableZ: [0, 1],
    portPoints: [],
  }
  const mixedGridSolver = new HighDensitySolverA12({
    ...solverProps,
    nodeWithPortPoints,
  })
  const uniformGridSolver = new HighDensitySolverA11({
    ...solverProps,
    nodeWithPortPoints,
  })

  mixedGridSolver.setup()
  uniformGridSolver.setup()

  expect(mixedGridSolver.fineGridCellThickness).toBe(4)
  const middleRegion = mixedGridSolver.regions.find(
    (region) => region.name === "middle",
  )!
  expect(middleRegion).toMatchObject({ cellScale: 4 })
  expect(middleRegion.fineCols % middleRegion.cellScale).not.toBe(0)
  expect(mixedGridSolver.gridStats.states).toBeLessThan(
    uniformGridSolver.gridStats.states * 0.4,
  )

  const visited = new Uint8Array(mixedGridSolver.planeSize)
  const queue = new Int32Array(mixedGridSolver.planeSize)
  let head = 0
  let tail = 1
  queue[0] = 0
  visited[0] = 1
  while (head < tail) {
    const cellId = queue[head++]!
    const neighborStart = mixedGridSolver.neighborOffset[cellId]!
    const neighborEnd = mixedGridSolver.neighborOffset[cellId + 1]!
    for (let index = neighborStart; index < neighborEnd; index++) {
      const neighborId = mixedGridSolver.neighborIds[index]!
      if (visited[neighborId]) continue
      visited[neighborId] = 1
      queue[tail++] = neighborId
    }
  }
  expect(tail).toBe(mixedGridSolver.planeSize)
})

test("A12 preserves both exact endpoints when they share one grid cell", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "same-cell",
    center: { x: 0, y: 0 },
    width: 0.4,
    height: 0.4,
    availableZ: [0, 1],
    portPoints: [
      {
        portPointId: "start",
        connectionName: "same-cell-connection",
        rootConnectionName: "same-cell-root",
        x: -0.19,
        y: -0.19,
        z: 0,
      },
      {
        portPointId: "end",
        connectionName: "same-cell-connection",
        rootConnectionName: "same-cell-root",
        x: -0.18,
        y: -0.18,
        z: 0,
      },
    ],
  }
  const solver = new HighDensitySolverA12({
    ...solverProps,
    nodeWithPortPoints,
  })

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.getOutput()).toEqual([
    expect.objectContaining({
      rootConnectionName: "same-cell-root",
      route: [
        nodeWithPortPoints.portPoints[0],
        nodeWithPortPoints.portPoints[1],
      ],
    }),
  ])
})

test("A12 preserves root-net metadata for overlapping MST branches", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "same-root-crossing",
    center: { x: 0, y: 0 },
    width: 0.2,
    height: 0.2,
    availableZ: [0],
    portPoints: [
      {
        connectionName: "branch-a",
        rootConnectionName: "net-1",
        portPointId: "a1",
        x: -0.075,
        y: -0.075,
        z: 0,
      },
      {
        connectionName: "branch-a",
        rootConnectionName: "net-1",
        portPointId: "a2",
        x: -0.025,
        y: -0.025,
        z: 0,
      },
      {
        connectionName: "branch-b",
        rootConnectionName: "net-1",
        portPointId: "b1",
        x: -0.075,
        y: -0.025,
        z: 0,
      },
      {
        connectionName: "branch-b",
        rootConnectionName: "net-1",
        portPointId: "b2",
        x: -0.025,
        y: -0.075,
        z: 0,
      },
    ],
  }
  const solver = new HighDensitySolverA12({
    ...solverProps,
    nodeWithPortPoints,
    viaMinDistFromBorder: 0,
  })

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.getOutput().map((route) => route.rootConnectionName)).toEqual([
    "net-1",
    "net-1",
  ])
  expect(findRouteGeometryViolations(solver.getOutput())).toEqual([])
})

test("A12 rejects an unmodeled diagonal crossing at its final geometry gate", () => {
  const crossingRoutes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "diagonal-a",
      rootConnectionName: "root-a",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -0.1, y: -0.1, z: 0 },
        { x: 0.1, y: 0.1, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "diagonal-b",
      rootConnectionName: "root-b",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -0.1, y: 0.1, z: 0 },
        { x: 0.1, y: -0.1, z: 0 },
      ],
      vias: [],
    },
  ]
  class CrossingOutputSolver extends HighDensitySolverA12 {
    override getOutput() {
      return crossingRoutes
    }
  }
  const solver = new CrossingOutputSolver({
    ...solverProps,
    nodeWithPortPoints: {
      capacityMeshNodeId: "crossing-output",
      center: { x: 0, y: 0 },
      width: 0.4,
      height: 0.4,
      availableZ: [0, 1],
      portPoints: [],
    },
  })

  solver.solve()

  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeTrue()
  expect(solver.error).toContain("A12 solution failed geometry validation")
  expect(solver.error).toContain("crossing")
})

for (const testCase of cases) {
  test(`A12 solves ${testCase.id} without growing the node`, () => {
    const originalNode = structuredClone(testCase.nodeWithPortPoints)
    const solver = new HighDensitySolverA12({
      ...solverProps,
      nodeWithPortPoints: testCase.nodeWithPortPoints,
    })
    solver.setup()
    solver.MAX_ITERATIONS = testCase.maxExpectedIterations ?? 100_000
    solver.solve()

    const routes = solver.getOutput()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    const expectedFineCellSize = testCase.expectedFineCellSize ?? 0.05
    expect(solver.highResolutionCellSize).toBeCloseTo(expectedFineCellSize, 12)
    expect(solver.highResolutionCellThickness).toBe(
      testCase.expectedFineGridThickness ?? 16,
    )
    expect(solver.lowResolutionCellSize).toBeCloseTo(
      expectedFineCellSize * 4,
      12,
    )
    expect(solver.enableDiagonalMoves).toBeTrue()
    expect(routes).toHaveLength(testCase.expectedRouteCount)
    expect(findRouteGeometryViolations(routes)).toEqual([])
    expect(testCase.nodeWithPortPoints).toEqual(originalNode)
    expect(solver.nodeWithPortPoints.width).toBe(originalNode.width)
    expect(solver.nodeWithPortPoints.height).toBe(originalNode.height)

    const portPointsByConnection = new Map<string, PortPoint[]>()
    for (const portPoint of originalNode.portPoints) {
      const portPoints =
        portPointsByConnection.get(portPoint.connectionName) ?? []
      portPoints.push(portPoint)
      portPointsByConnection.set(portPoint.connectionName, portPoints)
    }
    const expectedPhysicalPairs = new Set(
      [...portPointsByConnection.values()].flatMap((portPoints) =>
        getConnectionPortPointPairs(portPoints).map(([start, end]) =>
          physicalPairKey(start, end),
        ),
      ),
    )
    const actualPhysicalPairCounts = new Map<string, number>()
    for (const route of routes) {
      const key = physicalPairKey(route.route[0]!, route.route.at(-1)!)
      actualPhysicalPairCounts.set(
        key,
        (actualPhysicalPairCounts.get(key) ?? 0) + 1,
      )
    }
    expect(new Set(actualPhysicalPairCounts.keys())).toEqual(
      expectedPhysicalPairs,
    )
    expect([...actualPhysicalPairCounts.values()]).toEqual(
      Array.from({ length: expectedPhysicalPairs.size }, () => 1),
    )

    for (const route of routes) {
      const matchingPorts = originalNode.portPoints.filter(
        (portPoint) => portPoint.connectionName === route.connectionName,
      )
      expect(route.rootConnectionName).toBe(
        matchingPorts[0]!.rootConnectionName,
      )
      expect(
        matchingPorts.some((portPoint) =>
          isSamePoint(portPoint, route.route[0]!),
        ),
      ).toBeTrue()
      expect(
        matchingPorts.some((portPoint) =>
          isSamePoint(portPoint, route.route[route.route.length - 1]!),
        ),
      ).toBeTrue()
    }
  })
}
