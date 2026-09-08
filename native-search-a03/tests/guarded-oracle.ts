// Untimed ABI controls against the unchanged original entry points.
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { a03SearchWasmBase64 } from "../../lib/native-search/a03SearchWasmBytes"
import {
  assertBulkMaterialization,
  assertDistanceViews,
} from "./bulk-view-controls"

const bytes = process.argv[2]
  ? readFileSync(process.argv[2])
  : Buffer.from(a03SearchWasmBase64, "base64")
const module = new WebAssembly.Module(bytes)
const costs = [1, 8, 0.5, 0.75, 1.5, 10]
let cases = 0
let boundaries = 0
let injectedThrows = 0
const injected = new Error("guarded ABI host exception")
function create(layers = 2, failAt = -1) {
  let memory: WebAssembly.Memory
  const calls: unknown[] = []
  const e = new WebAssembly.Instance(module, {
    a03_host: {
      hypot(dx: number, dy: number) {
        calls.push(["hypot", dx, dy])
        if (calls.length === failAt) throw injected
        return Math.hypot(dx, dy)
      },
      footprint(cell: number, destination: number, capacity: number) {
        calls.push(["footprint", cell])
        if (calls.length === failAt) throw injected
        assert.ok(capacity > 0)
        new Int32Array(memory.buffer, destination, 1)[0] = cell
        return 1
      },
    },
  }).exports as any
  memory = e.memory
  const array = (kind: number, C: any) =>
    new C(memory.buffer, e.a03_pointer(kind), e.a03_length(kind))
  assert.equal(e.a03_setup(5, layers, 4, 0, 3), 1)
  array(1, Float64Array).set([0, 1, 2, 3, 4])
  array(2, Float64Array).fill(0)
  array(3, Int32Array).set([0, 1, 2, 3, 4, 4])
  array(4, Int32Array).set([1, 2, 3, 4])
  array(5, Float32Array).fill(1)
  array(12, Uint8Array).set([1, 0, 0])
  assert.equal(e.a03_validate_inputs(), 1)
  assert.equal(e.a03_begin(1, 0, 0, 0, 0, 4, 6, 0, ...costs), 1)
  function snapshot() {
    e.a03_publish_state()
    const state = Buffer.from(
      array(30, Uint32Array).buffer.slice(
        e.a03_pointer(30),
        e.a03_pointer(30) + 32,
      ),
    )
    e.a03_export_snapshot()
    const words = Array.from(array(40, BigUint64Array)) as bigint[]
    assertBulkMaterialization(e, words)
    assertDistanceViews(e)
    e.a03_export_distance_cache()
    const distance = Array.from(array(41, BigUint64Array))
    return { state, words, distance, calls: calls.slice() }
  }
  return { e, array, snapshot, calls }
}
function equal(a: ReturnType<typeof create>, b: ReturnType<typeof create>) {
  assert.deepEqual(a.snapshot(), b.snapshot())
  boundaries++
}
function run(call: () => number) {
  try {
    return { value: call(), error: undefined }
  } catch (error) {
    return { value: undefined, error }
  }
}

// Full raw state is unchanged on an unsupported first row, with no host call.
const badRows: Array<(a: ReturnType<typeof create>) => void> = [
  (a) => {
    a.array(3, Int32Array)[0] = -1
  },
  (a) => {
    a.array(3, Int32Array)[0] = 2
  },
  (a) => {
    a.array(3, Int32Array)[1] = 99
  },
  (a) => {
    a.array(4, Int32Array)[0] = -1
  },
  (a) => {
    a.array(4, Int32Array)[0] = 5
  },
  (a) => {
    a.array(5, Uint32Array)[0] = 0xffc00042
  },
  (a) => {
    a.array(1, Float64Array)[0] = Infinity
  },
  (a) => {
    a.array(2, Float64Array)[0] = NaN
  },
  (a) => {
    a.array(1, Float64Array)[1] = -Infinity
  },
  (a) => {
    a.array(2, Float64Array)[1] = NaN
  },
  (a) => {
    a.array(1, Float64Array)[4] = NaN
  },
  (a) => {
    a.array(2, Float64Array)[4] = Infinity
  },
]
for (const change of badRows) {
  for (const bulk of [false, true]) {
    const a = create()
    change(a)
    const before = a.snapshot()
    assert.equal(
      bulk
        ? a.e.a03_advance_many_guarded(7, ...costs)
        : a.e.a03_advance_guarded(...costs),
      bulk ? 0 : 3,
    )
    const after = a.snapshot()
    assert.equal(after.state.readUInt32LE(0), 3)
    assert.equal(after.state.readUInt32LE(12), 0)
    assert.equal(after.state.readUInt32LE(16), 0)
    after.state.writeUInt32LE(before.state.readUInt32LE(0), 0)
    assert.deepEqual(after, before)
    assert.deepEqual(a.calls, [])
    cases++
    boundaries++
  }
}

// A future unsupported row is encountered only after the exact valid prefix.
for (const layers of [2, 4, 6]) {
  const a = create(layers),
    b = create(layers)
  a.array(5, Uint32Array)[2] = 0x7fc00042
  b.array(5, Uint32Array)[2] = 0x7fc00042
  assert.equal(a.e.a03_advance_many_guarded(99, ...costs), 2)
  assert.equal(b.e.a03_advance_many(2, ...costs), 2)
  const actual = a.snapshot(),
    expected = b.snapshot()
  assert.equal(actual.state.readUInt32LE(0), 3)
  actual.state.writeUInt32LE(0, 0)
  assert.deepEqual(actual, expected)
  boundaries++
  a.array(5, Float32Array)[2] = 1
  b.array(5, Float32Array)[2] = 1
  assert.equal(a.e.a03_advance_many_guarded(99, ...costs), 2)
  assert.equal(b.e.a03_advance_many(99, ...costs), 2)
  equal(a, b)
  // Goal/empty/duplicate terminal state must not consult now-unused graph.
  for (const v of [a, b]) {
    v.array(1, Float64Array).fill(NaN)
    v.array(3, Int32Array).fill(-1)
  }
  assert.equal(a.e.a03_advance_guarded(...costs), 1)
  assert.equal(b.e.a03_advance(...costs), 1)
  equal(a, b)
  assert.equal(a.e.a03_advance_guarded(...costs), 2)
  assert.equal(b.e.a03_advance(...costs), 2)
  equal(a, b)
  cases++
}

// Live supported IEEE costs, both host throws, and raw partial backing all
// compare directly to the old entry points. No approximation is in the oracle.
for (const layers of [2, 4]) {
  for (const edge of [0, -0, Infinity, -Infinity, 1]) {
    for (const failAt of [-1, 1, 2, 3, 5]) {
      for (const bulk of [false, true]) {
        const a = create(layers, failAt),
          b = create(layers, failAt)
        for (const v of [a, b]) {
          v.array(5, Float32Array).fill(edge)
          v.array(6, Uint8Array).fill(1)
        }
        for (let i = 0; i < 30; i++) {
          const live =
            i % 3 === 0 ? costs : [NaN, Infinity, -Infinity, -0, 0, NaN]
          const actual = run(() =>
            bulk
              ? a.e.a03_advance_many_guarded(7, ...live)
              : a.e.a03_advance_guarded(...live),
          )
          const expected = run(() =>
            bulk ? b.e.a03_advance_many(7, ...live) : b.e.a03_advance(...live),
          )
          assert.deepEqual(actual, expected)
          equal(a, b)
          if (actual.error) {
            assert.equal(actual.error, injected)
            injectedThrows++
            break
          }
          if (!bulk && actual.value !== 0) break
          if (bulk && actual.value === 0) {
            assert.equal(
              a.e.a03_advance_guarded(...live),
              b.e.a03_advance(...live),
            )
            equal(a, b)
            break
          }
        }
        cases++
      }
    }
  }
}
assert.ok(injectedThrows > 20)
console.log(
  JSON.stringify({
    untimedCorrectnessOnly: true,
    cases,
    boundaries,
    injectedThrows,
    wasmSha256: createHash("sha256").update(bytes).digest("hex"),
  }),
)
