// The committed C49 start-seed oracle also proves direct view raw bits and FIFO.
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { gunzipSync } from "node:zlib"
import { a03SearchWasmBase64 } from "../../lib/native-search/a03SearchWasmBytes"
import { assertDistanceViews } from "./bulk-view-controls"
const fixturePath = resolve(import.meta.dir, "fixtures/distance-seeds.json.gz")
const payload = JSON.parse(gunzipSync(readFileSync(fixturePath)).toString())
const module = new WebAssembly.Module(
  Buffer.from(a03SearchWasmBase64, "base64"),
)
const instance = new WebAssembly.Instance(module, {
  a03_host: {
    hypot: () => {
      throw new Error("Seeds must not call hypot")
    },
    footprint: () => {
      throw new Error("Seeds must not request footprints")
    },
  },
})
const e = instance.exports as any,
  memory = e.memory as WebAssembly.Memory
assert.equal(e.a03_setup(payload.plane, payload.layers, 0, 0, 1), 1)
new Uint8Array(memory.buffer, e.a03_pointer(12), 1)[0] = 1
function number(hex: string) {
  return new Float64Array(new BigUint64Array([BigInt(`0x${hex}`)]).buffer)[0]!
}
function snapshot() {
  e.a03_export_distance_cache()
  const expected = Array.from(
    new BigUint64Array(memory.buffer, e.a03_pointer(41), e.a03_length(41)),
  )
  assertDistanceViews(e, expected)
  return expected
}

let expected: bigint[] = [],
  stamp = 0
for (const step of payload.steps) {
  assert.equal(
    e.a03_begin(
      ++stamp,
      0,
      0,
      step.cell,
      0,
      step.goal,
      number(step.h),
      0,
      1,
      1,
      1,
      1,
      1,
      1,
    ),
    1,
  )
  assert.equal(
    e.a03_seed_distance(
      step.goal,
      step.cell,
      number(step.dx),
      number(step.dy),
      number(step.distance),
    ),
    1,
  )
  expected = expected.slice(0, step.length)
  for (const [index, hex] of step.changed) expected[index] = BigInt(`0x${hex}`)
  assert.deepEqual(
    snapshot(),
    expected,
    `C49 start seed and FIFO state at ${stamp}`,
  )
  assert.equal(
    e.a03_seed_distance(
      step.goal,
      step.cell,
      number(step.dx),
      number(step.dy),
      number(step.distance),
    ),
    1,
  )
  assert.deepEqual(snapshot(), expected, "identical seed must be idempotent")
  assert.equal(e.a03_seed_distance(payload.plane, step.cell, 0, 0, 0), 0)
  assert.deepEqual(
    snapshot(),
    expected,
    "invalid seed must preserve every cache word",
  )
}
const stats = Array.from(new Uint32Array(memory.buffer, e.a03_pointer(33), 4))
assert.equal(stats[2], 0)
assert.equal(stats[3], 0)
e.a03_clear()
assert.equal(e.a03_length(41), 0)
assert.equal(e.a03_setup(65537, 1, 0, 0, 1), 1)
new Uint8Array(memory.buffer, e.a03_pointer(12), 1)[0] = 1
assert.equal(e.a03_begin(1, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1), 1)
assert.equal(e.a03_seed_distance(1, 0, 0, 0, 0), 0)
assert.deepEqual(snapshot(), [1n, 0n, 0n, 0n])
console.log(
  JSON.stringify({
    passed: true,
    reference: "C49 full ABI41 versus direct ABI43",
    seedBoundaries: stamp,
    exactRawSlotsAndFifo: true,
    invalidAndRepeatedSeedsPreserveState: true,
    oversizedCapacity: 0,
  }),
)
