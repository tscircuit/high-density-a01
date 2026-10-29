import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"

test("zero-initialized occupancy preserves owner zero, shared ports, diagonal conflicts, and rip clearing", (): void => {
  const solver = new HighDensitySolverA01({
    nodeWithPortPoints: {
      capacityMeshNodeId: "zero-occupancy",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      availableZ: [0, 1],
      portPoints: [
        { connectionName: "a", x: -0.45, y: -0.45, z: 0 },
        { connectionName: "a", x: 0.45, y: 0.45, z: 0 },
        { connectionName: "b", x: -0.45, y: -0.45, z: 0 },
        { connectionName: "b", x: 0.45, y: -0.45, z: 0 },
      ],
    },
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
    traceMargin: 0.1,
    showUsedCellMap: true,
  })
  solver.setup()
  const used = solver["usedCellsFlat"]
  const owners = solver["portOwnerFlat"]
  const diagonals = solver["usedDiagFlat"]
  expect(used.every((value): boolean => value === 0)).toBeTrue()
  expect(diagonals.every((value): boolean => value === 0)).toBeTrue()
  expect(owners[0]).toBe(-1)
  expect(owners[99]).toBe(1)
  expect(solver["shouldSkipFixedPortHalo"](0, 0)).toBeTrue()
  expect(solver["shouldSkipFixedPortHalo"](99, 0)).toBeFalse()
  expect(solver["shouldSkipFixedPortHalo"](44, 0)).toBeFalse()
  for (const outside of [-1, owners.length, NaN, Infinity]) {
    expect(solver["shouldSkipFixedPortHalo"](outside, 0)).toBeTrue()
  }

  const target = 44
  for (const owner of [-2_147_483_648, -2, -1, 0, 1, 2_147_483_647]) {
    used[target] = (owner | 0) + 1
    solver["computeMoveCostAndRips"](0, 0, 4, 3, 0, 4, 4, null)
    expect(solver["_moveRipped"]?.id).toBe(
      owner === -1 || owner === 0 ? undefined : owner,
    )
    expect(solver["_moveCost"]).toBeGreaterThan(0)
  }
  used[target] = 0
  const crossing = (3 * (solver.cols - 1) + 3) * 2 + 1
  diagonals[crossing] = 2
  solver["computeMoveCostAndRips"](0, 0, 3, 3, 0, 4, 4, null)
  expect(solver["_moveCost"]).toBe(-1)
  diagonals[crossing] = 0
  solver["computeMoveCostAndRips"](0, 0, 3, 3, 0, 4, 4, null)
  expect(solver["_moveCost"]).toBe(Math.SQRT2 * 0.1)

  used[target] = 1
  used[target + 1] = 2
  diagonals[crossing] = 1
  diagonals[crossing + 1] = 2
  solver["usedIndicesByConn"][0] = [target, target + 1]
  solver["usedDiagIndicesByConn"][0] = [crossing, crossing + 1]
  solver["ripTrace"](0)
  expect(used[target]).toBe(0)
  expect(used[target + 1]).toBe(2)
  expect(diagonals[crossing]).toBe(0)
  expect(diagonals[crossing + 1]).toBe(2)
  expect(solver["usedIndicesByConn"][0]).toEqual([])
  expect(solver["usedDiagIndicesByConn"][0]).toEqual([])
  expect(solver.visualize().rects).toHaveLength(2)
})
