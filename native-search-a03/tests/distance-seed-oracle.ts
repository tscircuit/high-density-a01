// Frozen C49 cache-layout control, separate from the C37 search-work oracle.
import { strict as assert } from "node:assert"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { gzipSync, gunzipSync } from "node:zlib"
import { a03SearchWasmBase64 } from "../../lib/native-search/a03SearchWasmBytes"
const fixturePath = resolve(import.meta.dir, "fixtures/distance-seeds.json.gz")
const manifestPath = resolve(
  import.meta.dir,
  "fixtures/distance-seeds-manifest.json",
)
function bits(value: number) {
  return new BigUint64Array(new Float64Array([value]).buffer)[0]!
}
function raw(array: Float64Array) {
  return new BigUint64Array(array.buffer, array.byteOffset, array.length)
}
function words(s: any) {
  const out: bigint[] = [
    1n,
    BigInt(s.distanceCacheCapacity),
    BigInt(s.distanceCacheSlots),
    BigInt(s.distanceByGoal.size),
  ]
  for (const [goal, table] of s.distanceByGoal) {
    out.push(BigInt(goal), BigInt(table.distance.length))
    for (const array of [table.dx, table.dy, table.distance])
      out.push(...raw(array))
    for (const value of table.valid) out.push(BigInt(value))
  }
  return out
}
if (process.argv[2] === "--capture") {
  const repository = resolve(
    process.argv[3] ?? "../high-density-a01-distance-memo",
  )
  const revision = "e2e837d1379f4e2cb7cef9abddaf5408919a0012"
  const relative = "lib/HighDensitySolverA03/HighDensitySolverA03.ts"
  const source = readFileSync(resolve(repository, relative))
  assert.deepEqual(
    source,
    execFileSync("git", ["-C", repository, "show", `${revision}:${relative}`]),
  )
  const { HighDensitySolverA03 } = await import(
    pathToFileURL(resolve(repository, relative)).href
  )
  const { defaultA03Params } = await import(
    pathToFileURL(resolve(repository, "lib/default-params.ts")).href
  )
  const data = JSON.parse(
    readFileSync(
      resolve(repository, "tests/dataset01/sample002/sample002.json"),
      "utf8",
    ),
  )
  const node = structuredClone(
    (Array.isArray(data) ? data[0] : data).nodeWithPortPoints ?? data,
  )
  const solver: any = new HighDensitySolverA03({
    ...defaultA03Params,
    nodeWithPortPoints: node,
  })
  solver.setup()
  const p = solver.planeSize
  assert.ok(p > 256 && p <= 65536)
  const steps: any[] = []
  let previous: bigint[] = []
  const seed = (goal: number, cell: number) => {
    const h = solver.computeH(0, cell, 0, goal)
    const table = solver.distanceByGoal.get(goal)
    const current = words(solver),
      changed: [number, string][] = []
    for (let i = 0; i < current.length; i++)
      if (current[i] !== previous[i])
        changed.push([i, current[i]!.toString(16)])
    steps.push({
      goal,
      cell,
      dx: bits(table.dx[cell]).toString(16),
      dy: bits(table.dy[cell]).toString(16),
      distance: bits(table.distance[cell]).toString(16),
      h: bits(h).toString(16),
      length: current.length,
      changed,
    })
    previous = current
  }
  // Start writes, repeated hits, changed point geometry, nonfinite geometry,
  // and enough new goals to evict at least one complete FIFO table.
  seed(0, 1)
  seed(0, 1)
  solver.cellCenterX[1] += 0.125
  seed(0, 1)
  solver.cellCenterX[1] = Infinity
  seed(0, 1)
  solver.cellCenterY[1] = NaN
  seed(0, 1)
  solver.cellCenterX[1] = solver.cellCenterX[0]
  solver.cellCenterY[1] = solver.cellCenterY[0]
  seed(0, 1)
  const goals = Math.min(p, Math.floor(65536 / p) + 8)
  for (let goal = 1; goal < goals; goal++) {
    seed(goal, (goal + 1) % p)
    if (goal % 5 === 0) seed(goal, (goal + 1) % p)
  }
  seed(0, 1)
  const payload = Buffer.from(
    JSON.stringify({ version: 1, plane: p, layers: solver.layers, steps }),
  )
  const compressed = gzipSync(payload, { level: 9 })
  writeFileSync(fixturePath, compressed)
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        referenceRevision: revision,
        referenceSourceSha256: createHash("sha256")
          .update(source)
          .digest("hex"),
        generatorSha256: createHash("sha256")
          .update(readFileSync(import.meta.path))
          .digest("hex"),
        steps: steps.length,
        plane: p,
        evicts: goals > Math.floor(65536 / p),
        sha256: createHash("sha256").update(payload).digest("hex"),
        compressedSha256: createHash("sha256").update(compressed).digest("hex"),
      },
      null,
      2,
    ) + "\n",
  )
}
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
  return Array.from(
    new BigUint64Array(memory.buffer, e.a03_pointer(41), e.a03_length(41)),
  )
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
    reference: "C49",
    seedBoundaries: stamp,
    exactRawSlotsAndFifo: true,
    invalidAndRepeatedSeedsPreserveState: true,
    oversizedCapacity: 0,
  }),
)
