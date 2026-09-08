import { strict as assert } from "node:assert"
import { a03SearchWasmBase64 } from "../../lib/native-search/a03SearchWasmBytes"

let memory: WebAssembly.Memory
let hypotCalls = 0
let footprintCalls = 0
const instance = new WebAssembly.Instance(
  new WebAssembly.Module(Buffer.from(a03SearchWasmBase64, "base64")),
  {
    a03_host: {
      hypot: (dx: number, dy: number) => {
        hypotCalls++
        return Math.hypot(dx, dy)
      },
      footprint: (cell: number, destination: number, capacity: number) => {
        footprintCalls++
        assert.ok(capacity >= 1)
        new Int32Array(memory.buffer, destination, 1)[0] = cell
        return 1
      },
    },
  },
)
const e = instance.exports as any
memory = e.memory
const costs = [1, 8, 0.5, 0.75, 1.5, 10]
function array(kind: number, Constructor: any) {
  return new Constructor(memory.buffer, e.a03_pointer(kind), e.a03_length(kind))
}
function setup() {
  assert.equal(e.a03_setup(3, 2, 4, 0, 3), 1)
  array(1, Float64Array).set([0, 1, 2])
  array(2, Float64Array).fill(0)
  array(3, Int32Array).set([0, 1, 3, 4])
  array(4, Int32Array).set([1, 0, 2, 1])
  array(5, Float32Array).fill(1)
  array(6, Uint8Array).fill(1)
  array(12, Uint8Array).set([1, 0, 0])
  assert.equal(e.a03_validate_inputs(), 1)
}
function finish(stamp: number) {
  assert.equal(
    e.a03_begin(
      stamp,
      0,
      0,
      0,
      1,
      2,
      Math.hypot(2, 0) * 1.5 + 1.5,
      0,
      ...costs,
    ),
    1,
  )
  let steps = 0
  while (steps < 100) {
    const completed = e.a03_advance_many(7, ...costs)
    steps += completed
    if (completed === 0) {
      const status = e.a03_advance(...costs)
      steps++
      if (status === 1) {
        e.a03_collect_goal()
        return Array.from(array(31, Int32Array))
      }
      assert.equal(status, 0)
    }
  }
  throw new Error("tiny lifecycle search did not finish")
}
setup()
const first = finish(1)
const calls = [hypotCalls, footprintCalls]
const firstStats = Array.from(array(33, Uint32Array))
assert.ok(Number(firstStats[2]) > 0)
assert.ok(Number(firstStats[3]) > 0)
assert.deepEqual(finish(2), first)
assert.deepEqual(
  [hypotCalls, footprintCalls],
  calls,
  "begin must preserve exact distance and footprint caches",
)
array(1, Float64Array)[0] = -0.25
finish(3)
assert.ok(hypotCalls > calls[0]!)
assert.equal(footprintCalls, calls[1])
const priorState = Array.from(array(30, Uint32Array))
assert.equal(e.a03_begin(0, 0, 0, 0, 1, 2, 1, 0, ...costs), 0)
assert.deepEqual(Array.from(array(30, Uint32Array)), priorState)
assert.equal(e.a03_setup(0, 2, 0, 0, 0), 0)
assert.deepEqual(Array.from(array(30, Uint32Array)), priorState)
e.a03_clear()
assert.deepEqual(Array.from(array(33, Uint32Array)), [0, 0, 0, 0])
setup()
const oldCalls = [hypotCalls, footprintCalls]
assert.deepEqual(finish(1), first)
assert.ok(hypotCalls > oldCalls[0]!)
assert.ok(footprintCalls > oldCalls[1]!)
e.a03_export_snapshot()
const beforeInvalidEdge = Array.from(
  new BigUint64Array(memory.buffer, e.a03_pointer(40), e.a03_length(40)),
)
const edgeWords = new Uint32Array(
  memory.buffer,
  e.a03_pointer(5),
  e.a03_length(5),
)
edgeWords[0] = 0x7fc00001
assert.equal(
  e.a03_validate_inputs(),
  0,
  "raw Float32 NaN payload must select JS before a pop",
)
assert.equal(e.a03_validate_graph(), 0)
assert.equal(e.a03_begin(2, 0, 0, 0, 1, 2, 1, 0, ...costs), 0)
e.a03_export_snapshot()
assert.deepEqual(
  Array.from(
    new BigUint64Array(memory.buffer, e.a03_pointer(40), e.a03_length(40)),
  ),
  beforeInvalidEdge,
)
array(5, Float32Array)[0] = Infinity
assert.equal(e.a03_validate_inputs(), 1)
assert.equal(e.a03_validate_graph(), 1)
array(5, Float32Array)[0] = -Infinity
assert.equal(e.a03_validate_inputs(), 1)
assert.equal(e.a03_validate_graph(), 1)
array(5, Float32Array)[0] = 1
for (const kind of [1, 2]) {
  const original = array(kind, Float64Array)[0]
  for (const value of [NaN, Infinity, -Infinity]) {
    array(kind, Float64Array)[0] = value
    assert.equal(
      e.a03_validate_inputs(),
      0,
      "nonfinite centers must select JS before a pop",
    )
    assert.equal(e.a03_validate_graph(), 0)
    e.a03_export_snapshot()
    assert.deepEqual(
      Array.from(
        new BigUint64Array(memory.buffer, e.a03_pointer(40), e.a03_length(40)),
      ),
      beforeInvalidEdge,
    )
  }
  array(kind, Float64Array)[0] = original
}
e.a03_resize_shared(2)
assert.equal(e.a03_length(10), 2)
assert.equal(
  e.a03_validate_inputs(),
  0,
  "unsupported CSR is a capability result",
)
array(9, Int32Array).set([0, 0, 0, 0, 0, 0, 2])
array(10, Int32Array).set([1, 2])
assert.equal(e.a03_validate_inputs(), 1)
assert.equal(e.a03_validate_graph(), 1)
array(9, Int32Array)[1] = -1
assert.equal(e.a03_validate_inputs(), 0)
assert.equal(
  e.a03_validate_graph(),
  1,
  "unchanged owner CSR is validated at begin",
)
console.log(
  JSON.stringify({
    passed: true,
    hypotCalls,
    footprintCalls,
    initialCacheStats: firstStats,
    lifecycle: [
      "search reuse",
      "live geometry",
      "invalid begin/setup",
      "release/setup reset",
      "CSR resize capability",
      "raw NaN edge rejection without a pop",
    ],
  }),
)
