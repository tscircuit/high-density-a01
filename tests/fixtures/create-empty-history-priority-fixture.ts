import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"

interface PaidOwner {
  id: number
  prev: PaidOwner | null
}

interface PriorityFixtureParams {
  targetLayer: number
  incumbentPriority: number
  successorCost: number
  heuristicCost: number
  rippedOwners: PaidOwner | null
}

export function createEmptyHistoryPriorityFixture(
  params: PriorityFixtureParams,
): { solver: HighDensitySolverA01; targetIndex: number } {
  const solver = new HighDensitySolverA01({
    nodeWithPortPoints: {
      capacityMeshNodeId: "empty-history-priority",
      center: { x: 0, y: 0 },
      width: 3,
      height: 3,
      availableZ: [0, 1],
      portPoints: [
        { connectionName: "route", x: -1.5, y: 0, z: 0 },
        { connectionName: "route", x: 1.5, y: 1.5, z: 1 },
      ],
    },
    cellSizeMm: 1,
    enableEmptyHistoryOpenPruning: true,
    traceThickness: 0.1,
    traceMargin: 0,
    viaDiameter: 0.3,
    viaMinDistFromBorder: 0,
    hyperParameters: { greedyMultiplier: 1 },
  })
  solver.setup()
  solver.step()
  const targetRow = 1
  const targetCol = params.targetLayer === 0 ? 2 : 1
  const targetIndex =
    (params.targetLayer * solver.rows + targetRow) * solver.cols + targetCol
  const currentIndex = solver.cols + 1
  solver["visitedStamp"].fill(solver["stamp"])
  solver["visitedStamp"][currentIndex] = 0
  solver["visitedStamp"][targetIndex] = 0
  solver["nodePool"] = [
    { z: 0, row: 1, col: 1, g: 0, parentIdx: -1, ripped: null },
    {
      z: params.targetLayer,
      row: targetRow,
      col: targetCol,
      g: params.incumbentPriority - params.heuristicCost,
      parentIdx: 0,
      ripped: null,
    },
  ]
  solver["heap"].clear()
  solver["heap"].push(params.incumbentPriority, 1, 1)
  solver["heap"].push(0, 0, 0)
  solver["seqCounter"] = 2
  solver["emptyHistoryPriorityStamp"][targetIndex] = solver["stamp"]
  solver["emptyHistoryBestPriority"][targetIndex] = params.incumbentPriority
  solver["computeH"] = (): number => params.heuristicCost
  solver["computeMoveCostAndRips"] = (): void => {
    solver["_moveCost"] = params.successorCost
    solver["_moveRipped"] = params.rippedOwners
  }
  return { solver, targetIndex }
}
