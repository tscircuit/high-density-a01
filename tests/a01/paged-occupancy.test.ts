import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import {
  createOwnerStorage,
  PagedOwnerStorage,
  readOwner,
} from "../../lib/HighDensitySolverA01/OwnerStorage"

test("paged occupancy preserves typed owners and complete routing across page boundaries", (): void => {
  const length = 4099
  const paged = new PagedOwnerStorage(length)
  const other = new PagedOwnerStorage(length)
  const emptyPage = paged["pages"][0]!
  expect(paged["pages"][1]).toBe(emptyPage)
  expect(other["pages"][0]).toBe(emptyPage)
  expect(other["pages"][1]).toBe(emptyPage)
  expect(emptyPage.every((owner): boolean => owner === -1)).toBeTrue()
  const original = new Int32Array(length).fill(-1)
  const outside = [
    -1,
    -0.5,
    0.5,
    length,
    length + 1,
    -(2 ** 31),
    2 ** 31 - 1,
    2 ** 31,
    2 ** 32 - 1,
    2 ** 32,
    2 ** 32 + 1,
    Number.MAX_SAFE_INTEGER,
    NaN,
    Infinity,
    -Infinity,
  ]
  for (const index of [...outside, -0, 4095, 4096, length - 1]) {
    paged.set(index, -1)
    paged.set(index, 4_294_967_295)
    expect(paged.get(index)).toBe(original[index])
  }
  expect(paged["pages"][0]).toBe(emptyPage)
  expect(paged["pages"][1]).toBe(emptyPage)
  paged.set(4096, 7)
  expect(paged["pages"][1]).not.toBe(emptyPage)
  expect(paged["pages"][0]).toBe(emptyPage)
  expect(paged.get(4097)).toBe(-1)
  expect(other.get(4096)).toBe(-1)
  const allocatedTail = paged["pages"][1]
  paged.set(4096, -1)
  expect(paged["pages"][1]).toBe(allocatedTail)
  expect(paged.get(4096)).toBe(-1)
  for (const owner of [
    -2_147_483_649,
    -2_147_483_648,
    -2,
    -1,
    0,
    1,
    2_147_483_647,
    2_147_483_648,
    4_294_967_296,
    Number.MAX_VALUE,
    0.75,
    NaN,
    Infinity,
    -Infinity,
  ]) {
    for (const index of [-0, 1, 4095, 4096, length - 1, ...outside]) {
      original[index] = owner
      paged.set(index, owner)
      expect(paged.get(index)).toBe(original[index])
    }
  }
  expect(paged["pages"][1]?.length).toBe(3)
  paged.set(4096, -1)
  expect(paged.get(4096)).toBe(-1)
  expect(paged.get(4095)).toBe(original[4095])
  expect(paged["pages"][0]).not.toBe(paged["pages"][1])
  expect(other["pages"][0]).toBe(emptyPage)
  expect(other["pages"][1]).toBe(emptyPage)
  other.set(0, 9)
  expect(other.get(0)).toBe(9)
  expect(paged.get(0)).toBe(original[0])
  expect(other["pages"][0]).not.toBe(emptyPage)
  expect(other["pages"][1]).toBe(emptyPage)
  expect(emptyPage.every((owner): boolean => owner === -1)).toBeTrue()
  const coerced = new PagedOwnerStorage(length)
  coerced.set(0, NaN)
  expect(coerced.get(0)).toBe(0)
  expect(coerced["pages"][0]).not.toBe(emptyPage)
  expect(coerced["pages"][1]).toBe(emptyPage)

  const dense = createOwnerStorage(262_143)
  const automatic = createOwnerStorage(262_144)
  expect(dense).toBeInstanceOf(Int32Array)
  expect(automatic).toBeInstanceOf(PagedOwnerStorage)
  expect(readOwner(dense, dense.length - 1)).toBe(-1)
  expect(readOwner(automatic, automatic.length - 1)).toBe(-1)
  expect(createOwnerStorage(NaN).length).toBe(0)
  expect(createOwnerStorage(1.5).length).toBe(1)
  expect((): void => {
    createOwnerStorage(-1)
  }).toThrow(RangeError)
  expect((): void => {
    createOwnerStorage(Infinity)
  }).toThrow(RangeError)
  for (const invalidLength of [-1, 0.5, NaN, Infinity, 2 ** 31, 2 ** 32]) {
    expect((): void => {
      new PagedOwnerStorage(invalidLength)
    }).toThrow(RangeError)
  }
  const large = new PagedOwnerStorage(0x7fff_ffff)
  for (const index of [0, -0, 2 ** 30, 0x7fff_fffe]) {
    large.set(index, 2_147_483_647)
    expect(large.get(index)).toBe(2_147_483_647)
  }
  for (const index of [0x7fff_ffff, 2 ** 31, 2 ** 32, 2 ** 32 + 1]) {
    large.set(index, 0)
    expect(large.get(index)).toBeUndefined()
  }
  expect(large.get(1)).toBe(-1)
  expect(large["pages"][0]?.length).toBe(4096)
  expect(large["pages"][524287]?.length).toBe(4095)
  expect(large["pages"][1]).toBe(emptyPage)
  expect(emptyPage.every((owner): boolean => owner === -1)).toBeTrue()

  const props = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "paged-routing",
      center: { x: 0, y: 0 },
      width: 51.2,
      height: 51.2,
      availableZ: [0, 1],
      portPoints: [
        { connectionName: "diagonal", x: -0.3, y: -0.3, z: 0 },
        { connectionName: "diagonal", x: 0.3, y: 0.3, z: 1 },
        { connectionName: "crossing", x: -0.3, y: 0.3, z: 1 },
        { connectionName: "crossing", x: 0.3, y: -0.3, z: 0 },
      ],
    },
    cellSizeMm: 0.1,
    traceThickness: 0.1,
    traceMargin: 0.1,
    viaDiameter: 0.3,
    stepMultiplier: 1,
  }
  const actual = new HighDensitySolverA01(structuredClone(props))
  const reference = new HighDensitySolverA01(structuredClone(props))
  actual.setup()
  reference.setup()
  for (const key of ["usedCellsFlat", "portOwnerFlat", "usedDiagFlat"] as const) {
    const storage = reference[key]
    expect(actual[key]).toBeInstanceOf(PagedOwnerStorage)
    expect((actual[key] as PagedOwnerStorage)["pages"][0]).toBe(emptyPage)
    const denseReference = new Int32Array(storage.length).fill(-1)
    for (let index = 0; index < storage.length; index++) {
      denseReference[index] = readOwner(storage, index)!
    }
    reference[key] = denseReference
  }
  while (!reference.solved && !reference.failed) {
    actual.step()
    reference.step()
    expect(actual.solved).toBe(reference.solved)
    expect(actual.failed).toBe(reference.failed)
    expect(actual.error).toBe(reference.error)
    expect(actual.iterations).toBe(reference.iterations)
    expect(actual.getOutput()).toEqual(reference.getOutput())
    expect(actual["nodePool"]).toEqual(reference["nodePool"])
    expect(actual["heap"]).toEqual(reference["heap"])
    expect(actual["ripCount"]).toEqual(reference["ripCount"])
    expect(actual["penalty2d"]).toEqual(reference["penalty2d"])
    expect(actual["visitedStamp"]).toEqual(reference["visitedStamp"])
  }
  expect(actual.solved).toBeTrue()
  for (const key of ["usedCellsFlat", "portOwnerFlat", "usedDiagFlat"] as const) {
    for (let index = 0; index < actual[key].length; index++) {
      expect(readOwner(actual[key], index)).toBe(readOwner(reference[key], index))
    }
  }
})
