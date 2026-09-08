import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { defaultA03Params } from "../../lib/default-params"
import sample003 from "../dataset01/sample003/sample003.json"
test("native layer-cache materialization preserves absent entries and the original frozen empty singleton", () => {
  for (const layers of [2, 4]) {
    const create = (native: boolean): any =>
      new HighDensitySolverA03({
        ...defaultA03Params,
        nodeWithPortPoints: {
          ...structuredClone(sample003),
          availableZ: Array.from({ length: layers }, (_, i) => i),
        },
        useNativeSearch: native,
      })
    const js = create(false),
      native = create(true)
    for (let i = 0; i < 100; i++) {
      js.step()
      native.step()
    }
    expect(native.nativeSearchActive).toBe(true)
    for (const s of [js, native]) {
      const original = s.getLayerOccupants
      s.seen = []
      s.getLayerOccupants = function (
        cell: number,
        active: number,
      ): readonly number[] {
        const values = Reflect.apply(original, this, [
          cell,
          active,
        ]) as readonly number[]
        this.seen.push({
          frozen: Object.isFrozen(values),
          values: Array.from(values),
        })
        return values
      }
    }
    js.step()
    native.step()
    expect(native.nativeSearchActive).toBe(false)
    expect(native.layerOccupantStamp).toEqual(js.layerOccupantStamp)
    expect(native.layerOccupantsByCell).toEqual(js.layerOccupantsByCell)
    let empty: readonly number[] | undefined
    let count = 0
    for (let i = 0; i < js.layerOccupantsByCell.length; i++) {
      const expected = js.layerOccupantsByCell[i],
        actual = native.layerOccupantsByCell[i]
      if (expected?.length === 0) {
        expect(Object.isFrozen(actual)).toBe(true)
        if (empty) expect(actual).toBe(empty)
        empty = actual
        count++
      }
    }
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < 100; i++) {
      js.step()
      native.step()
    }
    expect(native.seen).toEqual(js.seen)
    expect(native.getOutput()).toEqual(js.getOutput())
  }
})
