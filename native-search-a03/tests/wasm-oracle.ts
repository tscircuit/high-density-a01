// Actual generated-module correctness controls; never a timing benchmark.
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { gunzipSync } from "node:zlib"
import { a03SearchWasmBase64 } from "../../lib/native-search/a03SearchWasmBytes"

class Reader {
  at = 0
  constructor(readonly bytes: Buffer) {}
  u32() {
    const v = this.bytes.readUInt32LE(this.at)
    this.at += 4
    return v
  }
  u64() {
    const v = this.bytes.readBigUInt64LE(this.at)
    this.at += 8
    return v
  }
  f64() {
    const v = this.bytes.readDoubleLE(this.at)
    this.at += 8
    return v
  }
  array(width: number) {
    const n = this.u32(),
      v = this.bytes.subarray(this.at, this.at + n * width)
    this.at += v.length
    return v
  }
  delta(previous: bigint[]) {
    const a = previous.slice(0, this.u32())
    const n = this.u32()
    for (let i = 0; i < n; i++) a[this.u32()] = this.u64()
    return a
  }
}
const scalarBits = (v: number) => {
  const a = new Float64Array([v])
  return new BigUint64Array(a.buffer)[0]!
}
const cached = process.argv[2] !== "--uncached"
const data = cached
  ? Buffer.from(a03SearchWasmBase64, "base64")
  : readFileSync(process.argv[3]!)
const module = new WebAssembly.Module(data)
const widths = [8, 8, 4, 4, 4, 1, 4, 4, 4, 4, 8, 1]
let boundaries = 0,
  throws = 0,
  nativeSteps = 0,
  batchedSteps = 0,
  selected = 0,
  cacheHits = 0,
  cacheMisses = 0
for (const name of readdirSync(resolve(import.meta.dir, "fixtures")).filter(
  (n) => n.endsWith(".bin.gz") && !n.startsWith("heap-"),
)) {
  const reader = new Reader(
    gunzipSync(readFileSync(resolve(import.meta.dir, "fixtures", name))),
  )
  assert.equal(reader.bytes.subarray(0, 8).toString(), "C52A03V2")
  reader.at = 8
  const plane = reader.u32(),
    layers = reader.u32(),
    arrays = widths.map((w) => reader.array(w))
  const costs = Array.from({ length: 6 }, () => reader.f64()),
    search = Array.from({ length: 6 }, () => reader.u32()),
    startF = reader.f64()
  let expected = reader.delta([])
  const events: any[] = []
  const eventN = reader.u32()
  for (let i = 0; i < eventN; i++) {
    const kind = reader.u32(),
      error = reader.u32() === 1
    if (kind === 1)
      events.push({
        kind,
        error,
        dx: reader.u64(),
        dy: reader.u64(),
        value: error ? undefined : reader.f64(),
      })
    else {
      assert.equal(kind, 2)
      events.push({
        kind,
        error,
        cell: reader.u32(),
        value: error ? undefined : reader.array(4),
      })
    }
  }
  const frameN = reader.u32(),
    frames: any[] = []
  for (let i = 0; i < frameN; i++) {
    const frameCosts = Array.from({ length: 6 }, () => reader.f64()),
      status = reader.u32(),
      goal = reader.u32(),
      eventCount = reader.u32()
    expected = reader.delta(expected)
    frames.push({ costs: frameCosts, status, goal, eventCount, expected })
  }
  assert.equal(reader.at, reader.bytes.length)
  // Later-search stale buffers are covered by Rust snapshot restore. This
  // production ABI deliberately exposes no arbitrary full-state restore.
  if (
    search[0] !== 1 ||
    (cached &&
      name.startsWith("hypot-throw-") &&
      name !== "hypot-throw-1.bin.gz")
  )
    continue
  selected++
  for (const mode of ["ordinary", "bulk"]) {
    let eventIndex = 0
    const injected = new Error("frozen host throw")
    let memory: WebAssembly.Memory
    const instance = new WebAssembly.Instance(module, {
      a03_host: {
        hypot: cached
          ? name === "hypot-throw-1.bin.gz"
            ? () => {
                eventIndex++
                throw injected
              }
            : Math.hypot
          : (dx: number, dy: number) => {
              const event = events[eventIndex++]
              assert.equal(event.kind, 1)
              assert.equal(scalarBits(dx), event.dx)
              assert.equal(scalarBits(dy), event.dy)
              if (event.error) throw injected
              return event.value
            },
        footprint: (cell: number, destination: number, capacity: number) => {
          if (cached) while (events[eventIndex]?.kind === 1) eventIndex++
          const event = events[eventIndex++]
          assert.equal(event.kind, 2)
          assert.equal(cell, event.cell)
          if (event.error) throw injected
          assert.ok(event.value.length / 4 <= capacity)
          new Uint8Array(memory.buffer, destination, event.value.length).set(
            event.value,
          )
          return event.value.length / 4
        },
      },
    })
    const e = instance.exports as any
    memory = e.memory
    assert.equal(e.a03_abi_version(), 1)
    assert.equal(
      e.a03_setup(
        plane,
        layers,
        arrays[3]!.length / 4,
        arrays[9]!.length / 4,
        arrays[11]!.length,
      ),
      1,
    )
    for (let i = 0; i < arrays.length; i++)
      new Uint8Array(
        memory.buffer,
        e.a03_pointer(i + 1),
        arrays[i]!.length,
      ).set(arrays[i]!)
    assert.equal(e.a03_validate_inputs(), 1)
    assert.equal(e.a03_begin(...search, startF, 0, ...costs), 1)
    let n = 0
    while (n < frames.length) {
      let count = 1
      if (mode === "bulk" && !name.startsWith("live-costs")) {
        while (
          count < 7 &&
          n + count < frames.length &&
          frames[n + count - 1].status === 0 &&
          frames[n + count].status !== 1 &&
          frames[n + count].status !== 2
        )
          count++
      }
      const last = frames[n + count - 1]
      const ordinary =
        mode === "ordinary" || last.status === 1 || last.status === 2
      let result: any, error: any
      try {
        result = ordinary
          ? e.a03_advance(...last.costs)
          : e.a03_advance_many(count, ...last.costs)
      } catch (caught) {
        error = caught
      }
      if (last.status === 3) {
        assert.equal(error, injected, `${name} ${mode} host exception`)
        throws++
      } else {
        assert.equal(error, undefined)
        assert.equal(result, ordinary ? last.status : count)
      }
      e.a03_publish_state()
      const state = Array.from(
        new Uint32Array(memory.buffer, e.a03_pointer(30), 8),
      )
      assert.equal(state[3], count)
      assert.equal(state[4], last.status === 3 ? count - 1 : count)
      assert.equal(state[1], Number(last.expected[1]))
      if (cached) {
        while (eventIndex < last.eventCount) {
          assert.equal(events[eventIndex].kind, 1)
          eventIndex++
        }
      }
      assert.equal(eventIndex, last.eventCount)
      e.a03_export_snapshot()
      const words = new BigUint64Array(
        memory.buffer,
        e.a03_pointer(40),
        e.a03_length(40),
      )
      assert.equal(
        words.length,
        last.expected.length,
        `${name} ${mode} snapshot length`,
      )
      for (let i = 0; i < words.length; i++)
        assert.equal(
          words[i],
          last.expected[i],
          `${name} ${mode} frame${n + count - 1} word${i}`,
        )
      if (last.status === 1) {
        assert.equal(state[2], last.goal)
        const poolHeader = 3 + Number(words[2]) * 2
        const poolStart = poolHeader + 2
        const ripHeader = poolStart + Number(words[poolHeader + 1]) * 6
        const ripStart = ripHeader + 2
        const pairs: number[][] = []
        let node = last.goal
        while (node >= 0) {
          const at = poolStart + node * 6
          pairs.push([Number(words[at]) | 0, Number(words[at + 1]) | 0])
          node = Number(words[at + 3]) | 0
        }
        const expectedCells = pairs.reverse().flat()
        const expectedRips: number[] = []
        let head = Number(words[poolStart + last.goal * 6 + 4]) | 0
        while (head >= 0) {
          expectedRips.push(Number(words[ripStart + head * 2]) | 0)
          head = Number(words[ripStart + head * 2 + 1]) | 0
        }
        e.a03_collect_goal()
        assert.deepEqual(
          Array.from(
            new Int32Array(memory.buffer, e.a03_pointer(31), e.a03_length(31)),
          ),
          expectedCells,
        )
        assert.deepEqual(
          Array.from(
            new Int32Array(memory.buffer, e.a03_pointer(32), e.a03_length(32)),
          ),
          expectedRips,
        )
      }
      nativeSteps += count
      if (!ordinary) batchedSteps += count
      boundaries++
      n += count
    }
    assert.equal(eventIndex, events.length)
    const stats = Array.from(
      new Uint32Array(memory.buffer, e.a03_pointer(33), 4),
    )
    assert.ok(stats[0]! <= 65536)
    cacheHits += stats[2]!
    cacheMisses += stats[3]!
    e.a03_clear()
    assert.deepEqual(
      Array.from(new Uint32Array(memory.buffer, e.a03_pointer(33), 4)),
      [0, 0, 0, 0],
    )
    assert.equal(e.a03_length(40), 0)
    assert.equal(e.a03_length(20), 0)
    assert.deepEqual(
      Array.from(new Uint32Array(memory.buffer, e.a03_pointer(30), 8)),
      [0, 0, 0xffffffff, 0, 0, 0, 0, 0],
    )
  }
}
assert.ok(selected >= (cached ? 19 : 21))
assert.ok(throws >= (cached ? 6 : 10))
if (cached) {
  assert.ok(cacheHits > 1000)
  assert.ok(cacheMisses > 100)
} else {
  assert.equal(cacheHits, 0)
  assert.equal(cacheMisses, 0)
}
assert.ok(batchedSteps > 1000)
const summary = {
  untimedCorrectnessOnly: true,
  cached,
  cacheHits,
  cacheMisses,
  wasmSha256: createHash("sha256").update(data).digest("hex"),
  selectedCases: selected,
  boundaries,
  throws,
  nativeSteps,
  batchedSteps,
}
writeFileSync(
  resolve(
    import.meta.dir,
    `wasm-${cached ? "cached" : "uncached"}-oracle-summary.json`,
  ),
  JSON.stringify(summary, null, 2) + "\n",
)
console.log(JSON.stringify(summary))
