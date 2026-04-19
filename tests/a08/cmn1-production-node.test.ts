import { expect, setDefaultTimeout, test } from "bun:test"
import { defaultA08Params, defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA08 } from "../../lib/HighDensitySolverA08/HighDensitySolverA08"
import type { NodeWithPortPoints } from "../../lib/types"
import {
  findRouteGeometryViolations,
  findSameLayerIntersections,
} from "../fixtures/validateNoIntersections"

setDefaultTimeout(120_000)

// Derived from the production repro in
// /Users/seve/Downloads/cmn_1-nodeWithPortPoints (7).json
const productionCmn1NodeWithPortPoints = {
  capacityMeshNodeId: "cmn_1",
  center: {
    x: 0,
    y: 11.065,
  },
  width: 4.810175999999999,
  height: 9.940000000000001,
  portPoints: [
    {
      portPointId: "ce27_pp0_z0::0",
      x: -2.405088,
      y: 14.207498999999999,
      z: 0,
      connectionName: "source_net_7_mst1",
      rootConnectionName: "source_net_7",
    },
    {
      portPointId: "ce60_pp0_z0::0",
      x: 2.4050879500000404,
      y: 12.065000000000087,
      z: 0,
      connectionName: "source_net_7_mst1",
      rootConnectionName: "source_net_7",
    },
    {
      portPointId: "ce25_pp4_z1::1",
      x: -2.405088,
      y: 7.017500999999999,
      z: 1,
      connectionName: "source_net_7_mst3",
      rootConnectionName: "source_net_7",
    },
    {
      portPointId: "ce57_pp5_z1::1",
      x: 2.4050879999999997,
      y: 12.154998,
      z: 1,
      connectionName: "source_net_7_mst3",
      rootConnectionName: "source_net_7",
    },
    {
      portPointId: "ce56_pp0_z0::0",
      x: 2.405088,
      y: 10.16,
      z: 0,
      connectionName: "source_net_6",
      rootConnectionName: "source_net_6",
    },
    {
      portPointId: "ce44_pp0_z1::1",
      x: -0.15499999999999997,
      y: 6.094999999999999,
      z: 1,
      connectionName: "source_net_6",
      rootConnectionName: "source_net_6",
    },
    {
      portPointId: "ce42_pp0_z1::1",
      x: -0.635,
      y: 6.094999999999999,
      z: 1,
      connectionName: "source_net_5_mst1",
      rootConnectionName: "source_net_5",
    },
    {
      portPointId: "ce52_pp4_z1::1",
      x: 2.4050879999999997,
      y: 9.5810004,
      z: 1,
      connectionName: "source_net_5_mst1",
      rootConnectionName: "source_net_5",
    },
    {
      portPointId: "ce43_pp1_z0::0",
      x: 0,
      y: 16.035,
      z: 0,
      connectionName: "source_net_3_mst0",
      rootConnectionName: "source_net_3",
    },
    {
      portPointId: "ce61_pp6_z0::0",
      x: 2.405088,
      y: 14.207498999999999,
      z: 0,
      connectionName: "source_net_3_mst0",
      rootConnectionName: "source_net_3",
    },
    {
      portPointId: "ce30_pp0_z0::0",
      x: -2.4050879500000404,
      y: 8.255000000000027,
      z: 0,
      connectionName: "source_net_3_mst1",
      rootConnectionName: "source_net_3",
    },
    {
      portPointId: "ce41_pp0_z0::0",
      x: -1,
      y: 16.034999999999997,
      z: 0,
      connectionName: "source_net_3_mst1",
      rootConnectionName: "source_net_3",
    },
    {
      portPointId: "ce31_pp0_z0::0",
      x: -2.405088,
      y: 8.89,
      z: 0,
      connectionName: "source_net_2",
      rootConnectionName: "source_net_2",
    },
    {
      portPointId: "ce38_pp1_z0::0",
      x: -0.95,
      y: 6.094999999999999,
      z: 0,
      connectionName: "source_net_2",
      rootConnectionName: "source_net_2",
    },
    {
      portPointId: "ce36_pp0_z0::0",
      x: -2.405088,
      y: 11.43,
      z: 0,
      connectionName: "source_net_0_mst1",
      rootConnectionName: "source_net_0",
    },
    {
      portPointId: "ce38_pp5_z0::0",
      x: 0.9499999999999997,
      y: 6.094999999999999,
      z: 0,
      connectionName: "source_net_0_mst1",
      rootConnectionName: "source_net_0",
    },
    {
      portPointId: "ce38_pp6_z0::0",
      x: 1.4249999999999998,
      y: 6.094999999999999,
      z: 0,
      connectionName: "source_net_0_mst1",
      rootConnectionName: "source_net_0",
    },
    {
      portPointId: "ce47_pp0_z1::1",
      x: 1.115,
      y: 6.094999999999999,
      z: 1,
      connectionName: "source_net_0_mst1",
      rootConnectionName: "source_net_0",
    },
  ],
  availableZ: [0, 1],
} satisfies NodeWithPortPoints

let cachedA01Solver: HighDensitySolverA01 | null = null
let cachedA08Solver: HighDensitySolverA08 | null = null

function getA01Solver() {
  if (cachedA01Solver) return cachedA01Solver

  const solver = new HighDensitySolverA01({
    ...defaultParams,
    nodeWithPortPoints: productionCmn1NodeWithPortPoints,
    effort: 10,
  })
  solver.MAX_ITERATIONS = 100_000_000
  solver.solve()
  cachedA01Solver = solver
  return solver
}

function getA08Solver() {
  if (cachedA08Solver) return cachedA08Solver

  const solver = new HighDensitySolverA08({
    ...defaultA08Params,
    nodeWithPortPoints: productionCmn1NodeWithPortPoints,
    effort: 10,
  })
  solver.MAX_ITERATIONS = 100_000_000
  solver.solve()
  cachedA08Solver = solver
  return solver
}

test("A01 preserves all inner segments for the production cmn_1 node", () => {
  const solver = getA01Solver()
  const routes = solver.getOutput()

  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(routes).toHaveLength(10)
  expect(
    routes.filter((route) => route.connectionName === "source_net_0_mst1"),
  ).toHaveLength(3)
  expect(findSameLayerIntersections(routes)).toHaveLength(0)
  expect(findRouteGeometryViolations(routes)).toHaveLength(0)
})

test("A08 does not synthesize same-layer crossings on the production cmn_1 node", () => {
  const solver = getA08Solver()
  const routes = solver.getOutput()

  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(routes).toHaveLength(10)
  expect(
    routes.filter((route) => route.connectionName === "source_net_0_mst1"),
  ).toHaveLength(3)
  expect(findSameLayerIntersections(routes)).toHaveLength(0)
  expect(findRouteGeometryViolations(routes)).toHaveLength(0)
})
