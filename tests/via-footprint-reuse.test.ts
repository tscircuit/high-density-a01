import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA03 } from "../lib/HighDensitySolverA03/HighDensitySolverA03"
import type { NodeWithPortPoints } from "../lib/types"

type Solver = HighDensitySolverA01 | HighDensitySolverA03
type SolverKind = "A01" | "A03"
type Scenario = {
  layers: number
  copper: "empty" | "foreign" | "same-root"
  blocked: "none" | "first" | "all"
}
type Probe = {
  unsolvedSegs: Array<{ connId: number }>
  planeSize: number
  usedCellsFlat: Int32Array
  portOwnerFlat: Int32Array
  connIdToRootNet: string[]
  overlapFriendlyRootNets: Set<string>
  nodePool: unknown
  heap: unknown
  ripChain?: unknown
  _viaOccs: number[]
  _moveCost: number
  _moveRipped?: unknown
  _moveRippedHead?: number
  _moveRipCount?: number
  fillViaOccupants(...args: number[]): void
  computeMoveCostAndRips(...args: unknown[]): void
}
type Scan = { args: number[]; occupants: number[] }
type InstrumentedSolver = { solver: Solver; probe: Probe; scans: Scan[] }
type SearchState = {
  nodePool: unknown
  heap: unknown
  ripChain: unknown
  cost: number
  ripped: unknown
  rippedHead: number | undefined
  ripCount: number | undefined
}
type SharedProps = Pick<
  ConstructorParameters<typeof HighDensitySolverA01>[0],
  | "nodeWithPortPoints"
  | "viaDiameter"
  | "traceThickness"
  | "traceMargin"
  | "viaMinDistFromBorder"
>

const createSolver = (kind: SolverKind, layers: number): Solver => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "four-layer-via-footprint",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    availableZ: Array.from(
      { length: layers },
      (_: unknown, index: number): number => index,
    ),
    portPoints: [
      { x: 0.05, y: 0.05, z: 0, connectionName: "route-a" },
      { x: -0.35, y: 0.35, z: 0, connectionName: "route-a" },
      { x: -0.35, y: -0.35, z: 0, connectionName: "route-b" },
      { x: -0.25, y: -0.35, z: 0, connectionName: "route-b" },
      { x: 0.35, y: -0.35, z: 0, connectionName: "route-c" },
      { x: 0.25, y: -0.35, z: 0, connectionName: "route-c" },
    ],
  }
  const sharedProps: SharedProps = {
    nodeWithPortPoints,
    viaDiameter: 0.45,
    traceThickness: 0.1,
    traceMargin: 0.1,
    viaMinDistFromBorder: 0,
  }
  return kind === "A01"
    ? new HighDensitySolverA01({ ...sharedProps, cellSizeMm: 0.1 })
    : new HighDensitySolverA03({
        ...sharedProps,
        highResolutionCellSize: 0.1,
        highResolutionCellThickness: 2,
        lowResolutionCellSize: 0.4,
      })
}

const instrumentSolver = (
  solver: Solver,
  useReferenceScan: boolean,
): InstrumentedSolver => {
  solver.setup()
  const probe: Probe = solver as unknown as Probe
  probe.unsolvedSegs.sort(
    (left: { connId: number }, right: { connId: number }): number =>
      left.connId - right.connId,
  )
  solver.step()
  const scans: Scan[] = []
  const fillViaOccupants: Probe["fillViaOccupants"] = probe.fillViaOccupants
  probe.fillViaOccupants = (...args: number[]): void => {
    fillViaOccupants.apply(probe, args)
    scans.push({ args, occupants: [...probe._viaOccs] })
  }
  if (useReferenceScan) {
    const computeMoveCostAndRips: Probe["computeMoveCostAndRips"] =
      probe.computeMoveCostAndRips
    const originalArgumentCount: number =
      solver instanceof HighDensitySolverA01 ? 8 : 7
    probe.computeMoveCostAndRips = (...args: unknown[]): void => {
      // Force the original per-target scan for an exact search comparison.
      computeMoveCostAndRips.apply(probe, [
        ...args.slice(0, originalArgumentCount),
        undefined,
      ])
    }
  }
  return { solver, probe, scans }
}

const getSearchState = (probe: Probe): SearchState => {
  return structuredClone({
    nodePool: probe.nodePool,
    heap: probe.heap,
    ripChain: probe.ripChain,
    cost: probe._moveCost,
    ripped: probe._moveRipped,
    rippedHead: probe._moveRippedHead,
    ripCount: probe._moveRipCount,
  })
}

test("via neighbors reuse footprints without changing search state", (): void => {
  const scenarios: Scenario[] = [
    { layers: 4, copper: "foreign", blocked: "none" },
    { layers: 4, copper: "empty", blocked: "none" },
    { layers: 4, copper: "same-root", blocked: "none" },
    { layers: 4, copper: "foreign", blocked: "first" },
    { layers: 4, copper: "foreign", blocked: "all" },
    { layers: 2, copper: "foreign", blocked: "none" },
    { layers: 1, copper: "empty", blocked: "none" },
  ]
  for (const kind of ["A01", "A03"] as const) {
    for (const scenario of scenarios) {
      const actual: InstrumentedSolver = instrumentSolver(
        createSolver(kind, scenario.layers),
        false,
      )
      const reference: InstrumentedSolver = instrumentSolver(
        createSolver(kind, scenario.layers),
        true,
      )
      for (const { probe } of [actual, reference]) {
        if (scenario.copper === "same-root") {
          probe.connIdToRootNet.fill("shared")
          probe.overlapFriendlyRootNets.add("shared")
        }
        if (scenario.blocked !== "none") {
          probe.portOwnerFlat.fill(
            1,
            probe.planeSize,
            scenario.blocked === "first"
              ? probe.planeSize * 2
              : probe.portOwnerFlat.length,
          )
        }
      }
      for (let expansion: number = 0; expansion < 4; expansion++) {
        for (const { probe, scans } of [actual, reference]) {
          scans.length = 0
          // Changing the physical owner between expansions catches stale reuse.
          probe.usedCellsFlat.fill(
            scenario.copper === "empty" ? -1 : 1 + (expansion % 2),
            probe.planeSize,
          )
        }
        reference.solver.step()
        actual.solver.step()
        expect(getSearchState(actual.probe)).toEqual(
          getSearchState(reference.probe),
        )
        expect(actual.scans.length).toBe(reference.scans.length > 0 ? 1 : 0)
        for (const scan of reference.scans) {
          expect(scan).toEqual(actual.scans[0]!)
        }
        if (scenario.copper === "foreign" && actual.scans.length > 0) {
          expect(actual.scans[0]!.occupants).toEqual([1 + (expansion % 2)])
        }
      }
    }
    const actual: InstrumentedSolver = instrumentSolver(
      createSolver(kind, 4),
      false,
    )
    const reference: InstrumentedSolver = instrumentSolver(
      createSolver(kind, 4),
      true,
    )
    reference.solver.solve()
    actual.solver.solve()
    expect(actual.solver.solved).toBeTrue()
    expect(reference.solver.solved).toBeTrue()
    expect(actual.solver.failed).toBeFalse()
    expect(actual.solver.iterations).toBe(reference.solver.iterations)
    expect(actual.solver.getOutput()).toEqual(reference.solver.getOutput())
  }
})
