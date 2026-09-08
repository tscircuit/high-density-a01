import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { defaultA03Params } from "../../lib/default-params"
import sample003 from "../dataset01/sample003/sample003.json"
const create = (native: boolean): any =>
  new HighDensitySolverA03({
    ...defaultA03Params,
    nodeWithPortPoints: structuredClone(sample003),
    useNativeSearch: native,
  })
const raw = (array: Float64Array): number[] =>
  Array.from(new Uint32Array(array.buffer, array.byteOffset, array.length * 2))
const tableState = (map: Map<number, any>): unknown =>
  Array.from(map, ([goal, t]) => ({
    goal,
    dx: raw(t.dx),
    dy: raw(t.dy),
    distance: raw(t.distance),
    valid: Array.from(t.valid),
  }))
const state = (s: any): string =>
  JSON.stringify({
    iterations: s.iterations,
    open: s.openSet,
    active: s.activeConnection,
    search: s.searchIterations,
    hp: s.hyperParameters.viaBaseCost,
    output: s.getOutput(),
  })
test("native distance FIFO and raw slots survive fallback before a public Map hook observes warmed cache state", () => {
  const js = create(false),
    native = create(true)
  for (let i = 0; i < 100; i++) {
    js.step()
    native.step()
  }
  expect(native.nativeSearchSteps).toBeGreaterThan(0)
  const map = native.distanceByGoal
  const retained = new Map(map)
  const nativeDistance = native.nativeKernel.distanceSnapshot()
  expect(tableState(nativeDistance.tables)).toEqual(
    tableState(js.distanceByGoal),
  )
  expect(nativeDistance.slots).toBe(js.distanceCacheSlots)
  expect(nativeDistance.capacity).toBe(js.distanceCacheCapacity)
  const original = Map.prototype.get
  let current: any = null
  const a: Array<[number, number]> = [],
    b: Array<[number, number]> = []
  Map.prototype.get = function (key: unknown): any {
    const table = Reflect.apply(original, this, [key])
    if (
      current &&
      table?.valid instanceof Uint8Array &&
      table?.dx instanceof Float64Array &&
      table?.dy instanceof Float64Array &&
      table?.distance instanceof Float64Array
    ) {
      let count = 0
      for (let i = 0; i < table.valid.length; i++)
        count += table.valid[i] === 1 ? 1 : 0
      current.hyperParameters.viaBaseCost = count > 32 ? 17 : 3
      const list = current === js ? a : b
      list[list.length] = [Number(key), count]
    }
    return table
  }
  try {
    for (let i = 0; i < 100; i++) {
      current = js
      js.step()
      current = native
      native.step()
      current = null
      expect(state(native)).toBe(state(js))
    }
  } finally {
    current = null
    Map.prototype.get = original
  }
  expect(b).toEqual(a)
  expect(a[0]![1]).toBeGreaterThan(32)
  expect(native.nativeSearchActive).toBe(false)
  expect(native.distanceByGoal).toBe(map)
  for (const [goal, table] of retained)
    expect(native.distanceByGoal.get(goal)).toBe(table)
  expect(tableState(native.distanceByGoal)).toEqual(
    tableState(js.distanceByGoal),
  )
})
