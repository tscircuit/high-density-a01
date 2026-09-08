import { expect, test } from "bun:test"
import { defaultA03Params } from "../../lib/default-params"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import type { NodeWithPortPoints } from "../../lib/types"

type State = {
  planeSize: number
  layers: number
  activeConnId: number
  connNameToId: Map<string, number>
  usedCellsFlat: Int32Array
  sharedCellsFlat: Array<number[] | undefined>
  nextStamp(): void
  getViaFootprint(cell: number): Int32Array
  getViaOccupants(cell: number, active: number): number[]
  fillTraceOccupants(flat: number, active: number, out: number[]): void
  pushFlatOccupants(flat: number, active: number, out: number[]): void
  addSharedOccupant(flat: number, owner: number): void
  removeOccupant(flat: number, owner: number): void
  replaceOccupants(flat: number, owner: number): void
}

const node: NodeWithPortPoints = {
  capacityMeshNodeId: "occupant-lifecycle",
  center: { x: 0, y: 0 },
  width: 2,
  height: 2,
  availableZ: [0, 1],
  portPoints: ["a", "b", "c"].flatMap((connectionName, i) => [
    {
      connectionName,
      rootConnectionName: i < 2 ? "shared" : "foreign",
      x: -1,
      y: (i - 1) / 2,
      z: 0,
    },
    {
      connectionName,
      rootConnectionName: i < 2 ? "shared" : "foreign",
      x: 1,
      y: (i - 1) / 2,
      z: 1,
    },
  ]),
}

test("A03 empty primary cells bypass occupant scans while shared ownership survives promotion and replacement", () => {
  for (const layers of [2, 4]) {
    const solver = new HighDensitySolverA03({
      ...defaultA03Params,
      nodeWithPortPoints: {
        ...node,
        availableZ: Array.from({ length: layers }, (_, z) => z),
      },
    })
    solver.setup()
    const state = solver as unknown as State
    const a = state.connNameToId.get("a")!,
      b = state.connNameToId.get("b")!,
      c = state.connNameToId.get("c")!
    const cell = Math.floor(state.planeSize / 2)
    const neighbor = state.getViaFootprint(cell).find((id) => id !== cell)!
    const flat = cell
    const shared = state.sharedCellsFlat
    const directPush = state.pushFlatOccupants.bind(state)
    let skippedEmpty = 0
    const check = () => {
      for (let i = 0; i < shared.length; i++) {
        if (shared[i]?.length) expect(state.usedCellsFlat[i]).not.toBe(-1)
      }
      for (const active of [a, b, c]) {
        state.activeConnId = active
        state.nextStamp()
        const expectedVia: number[] = []
        for (const occCell of state.getViaFootprint(cell)) {
          for (let z = 0; z < layers; z++)
            directPush(z * state.planeSize + occCell, active, expectedVia)
        }
        const expectedTrace: number[] = []
        directPush(flat, active, expectedTrace)
        // Original helper reference above reads all shared slots. Optimized
        // query entry points must not call it for empty primary ownership.
        state.pushFlatOccupants = (idx, conn, out) => {
          if (state.usedCellsFlat[idx] === -1)
            throw new Error("Empty cell called occupant helper")
          directPush(idx, conn, out)
        }
        state.sharedCellsFlat = new Proxy(shared, {
          get(target, key) {
            if (
              typeof key === "string" &&
              /^\d+$/.test(key) &&
              state.usedCellsFlat[Number(key)] === -1
            )
              throw new Error("Empty cell read shared occupants")
            return Reflect.get(target, key)
          },
        })
        expect([...state.getViaOccupants(cell, active)]).toEqual(expectedVia)
        const trace = [123]
        state.fillTraceOccupants(flat, active, trace)
        expect(trace).toEqual(expectedTrace)
        if (state.usedCellsFlat[flat] === -1) skippedEmpty++
        state.sharedCellsFlat = shared
        state.pushFlatOccupants = directPush
      }
    }
    check()
    state.usedCellsFlat[flat] = a
    state.usedCellsFlat[state.planeSize + neighbor] = c
    check()
    state.addSharedOccupant(flat, b)
    check()
    // Synthetic mixed-root shared owners retain the helper's full filtering
    // behavior; the fast path relies only on the primary-owner invariant.
    state.addSharedOccupant(flat, c)
    check()
    state.removeOccupant(flat, c)
    expect(shared[flat]).toEqual([b])
    check()
    state.removeOccupant(flat, a)
    expect(state.usedCellsFlat[flat]).toBe(b)
    expect(shared[flat]).toBeUndefined()
    check()
    state.removeOccupant(flat, b)
    expect(state.usedCellsFlat[flat]).toBe(-1)
    check()
    state.usedCellsFlat[flat] = a
    state.addSharedOccupant(flat, b)
    state.replaceOccupants(flat, c)
    expect(shared[flat]).toBeUndefined()
    check()
    state.removeOccupant(flat, c)
    check()
    expect(skippedEmpty).toBe(9)
  }
})
