import { expect, test } from "bun:test"
import { defaultA03Params } from "../../lib/default-params"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { canRunNativeA03FootprintGeometry } from "../../lib/native-search/canRunNativeA03FootprintGeometry"
import {
  canRunNativeA03Graph,
  NativeA03SearchKernel,
  type NativeA03Graph,
  type NativeA03Owners,
} from "../../lib/native-search/NativeA03SearchKernel"
import sample from "../dataset01/sample003/sample003.json"

test("native A03 geometry selection rejects unsupported shapes without executing their accessors", () => {
  const solver = new HighDensitySolverA03({
    ...defaultA03Params,
    nodeWithPortPoints: sample,
  })
  solver.setup()
  expect(canRunNativeA03FootprintGeometry(solver)).toBe(true)
  const fields = [
    "planeSize",
    "fineRows",
    "fineCols",
    "highResolutionCellSize",
    "viaKeepoutRadius",
    "boundsMinX",
    "boundsMinY",
    "cellMinX",
    "cellMinY",
    "cellMaxX",
    "cellMaxY",
    "regions",
  ]
  const source = Object.fromEntries(
    fields.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(solver, name)!.value,
    ]),
  )
  const copy = (): any => structuredClone(source)
  let accessorCalls = 0
  const getter = (): never => {
    accessorCalls++
    throw new Error("Geometry accessor must remain untouched")
  }
  for (const field of fields) {
    const geometry = copy()
    Object.defineProperty(geometry, field, { get: getter })
    expect(canRunNativeA03FootprintGeometry(geometry)).toBe(false)
  }
  for (const field of [
    "id",
    "fineOriginRow",
    "fineOriginCol",
    "fineRows",
    "fineCols",
    "cellScale",
    "rows",
    "cols",
    "offset",
  ]) {
    const geometry = copy()
    Object.defineProperty(geometry.regions[0], field, { get: getter })
    expect(canRunNativeA03FootprintGeometry(geometry)).toBe(false)
  }
  const indexedGetter = copy()
  Object.defineProperty(indexedGetter.regions, "0", { get: getter })
  expect(canRunNativeA03FootprintGeometry(indexedGetter)).toBe(false)
  expect(accessorCalls).toBe(0)

  for (const mutate of [
    (g: any) => g.regions[0].id++,
    (g: any) => g.regions[1].offset++,
    (g: any) => g.regions[0].rows++,
    (g: any) => (g.regions[0].fineOriginRow = g.fineRows),
    (g: any) => (g.regions[0].cellScale = 0),
    (g: any) => g.planeSize++,
    (g: any) => (g.highResolutionCellSize = 0),
    (g: any) => (g.fineCols = Infinity),
    (g: any) => (g.viaKeepoutRadius = NaN),
    (g: any) => (g.cellMinX = new DataView(new ArrayBuffer(g.planeSize * 8))),
    (g: any) =>
      (g.cellMaxY = new Float64Array(new SharedArrayBuffer(g.planeSize * 8))),
    (g: any) => (g.cellMinY = new Float64Array(g.planeSize + 1)),
  ]) {
    const geometry = copy()
    mutate(geometry)
    expect(canRunNativeA03FootprintGeometry(geometry)).toBe(false)
  }
  const detached = copy()
  structuredClone(detached.cellMinX.buffer, {
    transfer: [detached.cellMinX.buffer],
  })
  expect(canRunNativeA03FootprintGeometry(detached)).toBe(false)
  const lengthGetter = copy()
  Object.defineProperty(lengthGetter.cellMinX, "length", { get: getter })
  expect(canRunNativeA03FootprintGeometry(lengthGetter)).toBe(false)
  expect(accessorCalls).toBe(0)

  const graph: NativeA03Graph = {
    planeSize: solver.planeSize,
    layers: solver.layers,
    cellCenterX: solver.cellCenterX,
    cellCenterY: solver.cellCenterY,
    neighborOffset: solver.neighborOffset,
    neighborIds: solver.neighborIds,
    neighborCosts: solver.neighborCosts,
    viaAllowed: solver.viaAllowed,
  }
  expect(canRunNativeA03Graph(graph)).toBe(true)
  for (const name of [
    "cellCenterX",
    "cellCenterY",
    "neighborOffset",
    "neighborIds",
    "neighborCosts",
    "viaAllowed",
  ]) {
    expect(
      canRunNativeA03Graph({
        ...graph,
        [name]: new DataView(new ArrayBuffer(8)),
      }),
    ).toBe(false)
  }
  const cells = graph.planeSize * graph.layers
  const owners: NativeA03Owners = {
    usedCells: new Int32Array(cells).fill(-1),
    portOwners: new Int32Array(cells).fill(-1),
    sharedOffsets: new Int32Array(cells + 1),
    sharedIds: new Int32Array(0),
    penalties: new Float64Array(graph.planeSize),
    rootOverlap: new Uint8Array([1]),
  }
  for (const name of ["sharedIds", "rootOverlap"]) {
    expect(
      NativeA03SearchKernel.create(
        graph,
        {
          ...owners,
          [name]: new DataView(new ArrayBuffer(0)),
        } as unknown as NativeA03Owners,
        { getFootprint: () => new Int32Array(0) },
      ),
    ).toBeNull()
  }
})
