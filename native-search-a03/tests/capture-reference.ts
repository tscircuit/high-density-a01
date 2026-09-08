// Untimed frozen C37 oracle capture. This does not import or execute the kernel.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { gzipSync } from "node:zlib"

const repository = resolve(
  process.argv[2] ?? "../high-density-a01-layer-occupancy",
)
const revision = "8e363ef2a5a0449f03b8004a8d150b6b1b343092"
const relative = "lib/HighDensitySolverA03/HighDensitySolverA03.ts"
const source = await Bun.file(resolve(repository, relative)).bytes()
const original = execFileSync("git", [
  "-C",
  repository,
  "show",
  `${revision}:${relative}`,
])
if (!Buffer.from(source).equals(original))
  throw new Error("Reference source is not frozen C37")
const { HighDensitySolverA03 } = await import(
  pathToFileURL(resolve(repository, relative)).href
)
const { defaultA03Params } = await import(
  pathToFileURL(resolve(repository, "lib/default-params.ts")).href
)
const output = resolve(import.meta.dir, "fixtures")
mkdirSync(output, { recursive: true })
const f64Bits = (value: number) => {
  const bytes = new ArrayBuffer(8)
  const view = new DataView(bytes)
  view.setFloat64(0, value, true)
  return view.getBigUint64(0, true)
}
const backingBits = (array: Float64Array) =>
  new BigUint64Array(array.buffer, array.byteOffset, array.length)
const integer = (value: number) => BigInt(value >>> 0)
function words(s: any): bigint[] {
  const out: bigint[] = [1n, BigInt(s.heap.n), BigInt(s.heap.f.length)]
  for (let i = 0; i < s.heap.f.length; i++)
    out.push(backingBits(s.heap.f)[i]!, integer(s.heap.id[i]))
  out.push(BigInt(s.nodePool.length), BigInt(s.nodePool.z.length))
  for (let i = 0; i < s.nodePool.z.length; i++)
    out.push(
      integer(s.nodePool.z[i]),
      integer(s.nodePool.cellId[i]),
      backingBits(s.nodePool.g)[i]!,
      integer(s.nodePool.parent[i]),
      integer(s.nodePool.ripHead[i]),
      integer(s.nodePool.ripCount[i]),
    )
  out.push(BigInt(s.ripChain.length), BigInt(s.ripChain.connId.length))
  for (let i = 0; i < s.ripChain.connId.length; i++)
    out.push(integer(s.ripChain.connId[i]), integer(s.ripChain.prev[i]))
  const ints = (values: Iterable<number> & { length: number }) => {
    out.push(BigInt(values.length))
    for (const value of values) out.push(integer(value))
  }
  const floats = (values: Float64Array) => {
    out.push(BigInt(values.length))
    for (const value of backingBits(values)) out.push(value)
  }
  ints(s.visitedStamp)
  ints(s.visitedFlatStamp)
  ints(s.bestGStamp)
  floats(s.bestGValue)
  out.push(
    f64Bits(s._moveCost),
    integer(s._moveRippedHead),
    f64Bits(s._moveRipCount),
  )
  ints(s._viaOccs)
  ints(s._cellOccs)
  ints(s._layerOccs)
  for (const map of [s.viaOccupantsByCell, s.viaFootprintByCell]) {
    out.push(BigInt(map.size))
    for (const [key, value] of map) {
      out.push(integer(key))
      ints(value)
    }
  }
  out.push(BigInt(s.layerOccupantStamp.length))
  for (let i = 0; i < s.layerOccupantStamp.length; i++) {
    out.push(integer(s.layerOccupantStamp[i]))
    const value = s.layerOccupantsByCell[i]
    out.push(value === undefined ? 0n : 1n)
    if (value !== undefined) ints(value)
  }
  return out
}
class Writer {
  buffers: Buffer[] = []
  u32(v: number) {
    const b = Buffer.alloc(4)
    b.writeUInt32LE(v >>> 0)
    this.buffers.push(b)
  }
  u64(v: bigint) {
    const b = Buffer.alloc(8)
    b.writeBigUInt64LE(v)
    this.buffers.push(b)
  }
  f64(v: number) {
    this.u64(f64Bits(v))
  }
  array(a: ArrayLike<number>, kind: "u32" | "f64" | "f32" | "u8") {
    this.u32(a.length)
    if (
      (kind === "f64" && a instanceof Float64Array) ||
      (kind === "f32" && a instanceof Float32Array)
    ) {
      this.buffers.push(
        Buffer.from(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)),
      )
      return
    }
    const b = Buffer.alloc(a.length * { u32: 4, f64: 8, f32: 4, u8: 1 }[kind])
    for (let i = 0; i < a.length; i++) {
      if (kind === "u32") b.writeUInt32LE(a[i]! >>> 0, i * 4)
      if (kind === "f64") b.writeDoubleLE(a[i]!, i * 8)
      if (kind === "f32") b.writeFloatLE(a[i]!, i * 4)
      if (kind === "u8") b[i] = a[i]!
    }
    this.buffers.push(b)
  }
  delta(current: bigint[], previous: bigint[]) {
    this.u32(current.length)
    const changed: number[] = []
    for (let i = 0; i < current.length; i++)
      if (current[i] !== previous[i]) changed.push(i)
    this.u32(changed.length)
    for (const i of changed) {
      this.u32(i)
      this.u64(current[i]!)
    }
  }
}
const files = [
  "tests/dataset01/sample002/sample002.json",
  "tests/dataset01/sample003/sample003.json",
  "tests/dataset01/sample007/sample007.json",
  "tests/prev-next/prev-next.json",
  "tests/repros/repro03/repro03.json",
  "tests/repros/repro05/repro05.json",
]
const cases: Array<{
  name: string
  file: string
  stamp: number
  hypotThrow?: number
  footprintThrow?: number
  synthetic?: number
  liveCosts?: boolean
}> = []
for (let i = 0; i < files.length; i++) {
  cases.push({ name: `fixture-${i}-first`, file: files[i]!, stamp: 1 })
  if (i !== 3)
    cases.push({
      name: `fixture-${i}-later`,
      file: files[i]!,
      stamp: i === 0 ? 5 : 2,
    })
}
for (const layers of [2, 4, 6])
  for (const mode of [0, 1, 2])
    cases.push({
      name: `synthetic-${layers}-${mode}`,
      file: files[0]!,
      stamp: 1,
      synthetic: layers * 10 + mode,
    })
for (const mode of [3, 4])
  cases.push({
    name: `infinite-edge-${mode}`,
    file: files[0]!,
    stamp: 1,
    synthetic: 20 + mode,
  })
for (const nth of [1, 3, 9])
  cases.push({
    name: `hypot-throw-${nth}`,
    file: files[0]!,
    stamp: 1,
    hypotThrow: nth,
  })
for (const nth of [1, 2])
  cases.push({
    name: `footprint-throw-${nth}`,
    file: files[0]!,
    stamp: 1,
    footprintThrow: nth,
  })
cases.push({ name: "live-costs", file: files[0]!, stamp: 1, liveCosts: true })
const summaries = []
const builtinHypot = Math.hypot
for (const c of cases) {
  const fixture = await Bun.file(resolve(repository, c.file)).json()
  const data = Array.isArray(fixture) ? fixture[0] : fixture
  const node = structuredClone(data.nodeWithPortPoints ?? data)
  if (c.synthetic !== undefined) {
    const layers = Math.floor(c.synthetic / 10)
    node.width = 1.6
    node.height = 1.6
    node.availableZ = Array.from({ length: layers }, (_, z) => z)
    node.portPoints = [
      {
        connectionName: "a",
        x: node.center.x - node.width / 2,
        y: node.center.y,
        z: 0,
      },
      {
        connectionName: "a",
        x: node.center.x + node.width / 2,
        y: node.center.y,
        z: layers - 1,
      },
    ]
  }
  const s: any = new HighDensitySolverA03({
    ...defaultA03Params,
    nodeWithPortPoints: node,
    enableDiagonalMoves: c.synthetic !== undefined,
    ...(c.synthetic !== undefined ? { highResolutionCellThickness: 1 } : {}),
  })
  s.setup()
  while (
    !(s.stamp === c.stamp && s.activeConnSeg && s.searchIterations === 0)
  ) {
    if (s.solved || s.failed) throw new Error(`Could not reach ${c.name}`)
    s.step()
  }
  if (c.synthetic !== undefined) {
    const mode = c.synthetic % 10
    s.rootOverlapAllowed = new Uint8Array([1, 1, 0, 0, 0, 0])
    s.usedCellsFlat.fill(-1)
    s.portOwnerFlat.fill(-1)
    for (let i = 0; i < s.usedCellsFlat.length; i++) {
      if (i % 7 === 0) {
        s.usedCellsFlat[i] = 2
        s.sharedCellsFlat[i] = [1, 3, 2, 4, 3]
      }
      if (i % 11 === 0) s.portOwnerFlat[i] = 5
    }
    if (mode === 1) {
      s.hyperParameters.greedyMultiplier = 0
      s.hyperParameters.ripCost = 0
      s.penalty2d.fill(-0)
    }
    if (mode === 2) {
      s.hyperParameters.ripCost = -0.25
      s.hyperParameters.ripTracePenalty = 0.125
      s.hyperParameters.ripViaPenalty = -0.125
    }
    if (mode === 3) {
      s.neighborCosts.fill(Infinity)
      s.hyperParameters.greedyMultiplier = Infinity
    }
    if (mode === 4) s.neighborCosts.fill(-Infinity)
    // Match original start priority to the customized initial cost configuration.
    const seg = s.activeConnSeg
    s.heap.f[0] =
      s.computeH(seg.startZ, seg.startCellId, seg.endZ, seg.endCellId) *
      s.hyperParameters.greedyMultiplier
  }
  const writer = new Writer()
  writer.buffers.push(Buffer.from("C52A03V2"))
  writer.u32(s.planeSize)
  writer.u32(s.layers)
  for (const key of ["cellCenterX", "cellCenterY"]) writer.array(s[key], "f64")
  writer.array(s.neighborOffset, "u32")
  writer.array(s.neighborIds, "u32")
  writer.array(s.neighborCosts, "f32")
  writer.array(s.viaAllowed, "u8")
  writer.array(s.usedCellsFlat, "u32")
  writer.array(s.portOwnerFlat, "u32")
  const sharedOffsets = [0],
    shared: number[] = []
  for (const v of s.sharedCellsFlat) {
    if (v) shared.push(...v)
    sharedOffsets.push(shared.length)
  }
  writer.array(sharedOffsets, "u32")
  writer.array(shared, "u32")
  writer.array(s.penalty2d, "f64")
  writer.array(s.rootOverlapAllowed, "u8")
  const costs = () => [
    s.hyperParameters.viaBaseCost,
    s.hyperParameters.ripCost,
    s.hyperParameters.ripTracePenalty,
    s.hyperParameters.ripViaPenalty,
    s.hyperParameters.greedyMultiplier,
    s.penaltyCap,
  ]
  for (const v of costs()) writer.f64(v)
  for (const v of [
    s.stamp,
    s.activeConnId,
    s.activeConnSeg.startZ,
    s.activeConnSeg.startCellId,
    s.activeConnSeg.endZ,
    s.activeConnSeg.endCellId,
  ])
    writer.u32(v)
  writer.f64(s.heap.f[0])
  let previous = words(s)
  writer.delta(previous, [])
  const frames: any[] = []
  const events: any[] = []
  let goal = -1,
    hypotCalls = 0,
    footprintCalls = 0,
    stop = "prefix"
  s.finalizeRoute = (id: number) => {
    goal = id
  }
  const oldFootprint = s.getViaFootprint.bind(s)
  s.getViaFootprint = (cell: number) => {
    if (s.viaFootprintByCell.has(cell)) return oldFootprint(cell)
    footprintCalls++
    const event: any = {
      kind: 2,
      cell,
      throws: footprintCalls === c.footprintThrow,
    }
    events.push(event)
    if (event.throws) throw new Error("injected footprint")
    const value = oldFootprint(cell)
    event.value = Array.from(value)
    return value
  }
  Math.hypot = (dx: number, dy: number) => {
    hypotCalls++
    const event: any = { kind: 1, dx, dy, throws: hypotCalls === c.hypotThrow }
    events.push(event)
    if (event.throws) throw new Error("injected hypot")
    event.value = builtinHypot(dx, dy)
    return event.value
  }
  try {
    for (let step = 0; step < (c.synthetic !== undefined ? 600 : 128); step++) {
      const budget = Math.round(
        s.baseSearchBudgetIters *
          (1 + Math.min(s.ripCount[s.activeConnId] ?? 0, 10) * 0.25),
      )
      if (s.searchIterations + 1 > budget) {
        stop = "budget-boundary"
        break
      }
      if (c.liveCosts) {
        const value = [0.25, -0, Infinity, -Infinity, NaN, -0.5, 2][
          Math.floor(step / 3) % 7
        ]!
        s.hyperParameters.viaBaseCost = value
        s.hyperParameters.ripCost = step % 2 ? value : 1.5
        s.hyperParameters.ripTracePenalty = step % 3 ? 0.25 : value
        s.hyperParameters.ripViaPenalty = step % 4 ? value : 0.5
        s.hyperParameters.greedyMultiplier = step % 5 ? 1.25 : value
        s.penaltyCap = step % 6 ? value : 4
      }
      const frameCosts = costs()
      let status = 0
      try {
        s.stepOnce()
        if (goal >= 0) status = 1
        else if (s.failed) status = 2
      } catch (error) {
        if (!String(error).includes("injected")) throw error
        status = 3
      }
      const current = words(s)
      frames.push({
        status,
        goal,
        eventCount: events.length,
        current,
        costs: frameCosts,
      })
      if (status !== 0) {
        stop = ["advanced", "goal", "empty", "host-throw"][status]!
        break
      }
    }
  } finally {
    Math.hypot = builtinHypot
  }
  writer.u32(events.length)
  for (const e of events) {
    writer.u32(e.kind)
    writer.u32(e.throws ? 1 : 0)
    if (e.kind === 1) {
      writer.f64(e.dx)
      writer.f64(e.dy)
      if (!e.throws) writer.f64(e.value)
    } else {
      writer.u32(e.cell)
      if (!e.throws) writer.array(e.value, "u32")
    }
  }
  writer.u32(frames.length)
  for (const frame of frames) {
    for (const cost of frame.costs) writer.f64(cost)
    writer.u32(frame.status)
    writer.u32(frame.goal)
    writer.u32(frame.eventCount)
    writer.delta(frame.current, previous)
    previous = frame.current
  }
  const bytes = Buffer.concat(writer.buffers)
  const compressed = gzipSync(bytes, { level: 9 })
  writeFileSync(resolve(output, `${c.name}.bin.gz`), compressed)
  const summary = {
    ...c,
    frames: frames.length,
    stop,
    hypotCalls,
    footprintCalls,
    bytes: bytes.length,
    compressedBytes: compressed.length,
    compressedSha256: createHash("sha256").update(compressed).digest("hex"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
  summaries.push(summary)
  console.log(JSON.stringify(summary))
}
writeFileSync(
  resolve(output, "manifest.json"),
  JSON.stringify(
    {
      referenceRevision: revision,
      referenceSource: relative,
      referenceSourceSha256: createHash("sha256")
        .update(original)
        .digest("hex"),
      sourceGeneratorSha256: createHash("sha256")
        .update(await Bun.file(import.meta.path).bytes())
        .digest("hex"),
      untimedCorrectnessOnly: true,
      scope:
        "Search core states before TS finalization; complete backing arrays, caches, partial host errors; prefixes explicitly labeled",
      cases: summaries,
    },
    null,
    2,
  ) + "\n",
)

// Independent heap oracle includes the exact full backing arrays after every
// operation, including growth, clears, ties, signed zeros and non-total NaNs.
{
  const node = {
    capacityMeshNodeId: "heap-oracle",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    availableZ: [0, 1],
    portPoints: [],
  }
  const solver: any = new HighDensitySolverA03({
    ...defaultA03Params,
    nodeWithPortPoints: node,
  })
  solver.setup()
  const heap = solver.heap
  const writer = new Writer()
  writer.buffers.push(Buffer.from("C52HEAP1"))
  writer.u32(8200)
  let previous: bigint[] = [],
    seed = 0x4821794b,
    id = 0
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed
  }
  for (let step = 0; step < 8200; step++) {
    let operation: number,
      f = 0,
      pushed = -1,
      popped = -1
    if (
      step < 2200 ||
      heap.size === 0 ||
      (random() % 3 !== 0 && step % 777 !== 0)
    ) {
      operation = 0
      pushed = id++
      const edge = [0, -0, 1, 1, -1, NaN, Infinity, -Infinity]
      f =
        step % 4 === 0
          ? edge[random() % edge.length]!
          : ((random() % 100) - 50) / 8
      heap.push(f, pushed)
    } else if (step % 777 === 0) {
      operation = 2
      heap.clear()
    } else {
      operation = 1
      popped = heap.pop()
    }
    writer.u32(operation)
    writer.f64(f)
    writer.u32(pushed)
    writer.u32(popped)
    const current = [BigInt(heap.n), BigInt(heap.f.length)]
    for (let i = 0; i < heap.f.length; i++)
      current.push(backingBits(heap.f)[i]!, integer(heap.id[i]))
    writer.delta(current, previous)
    previous = current
  }
  const bytes = Buffer.concat(writer.buffers),
    compressed = gzipSync(bytes, { level: 9 })
  writeFileSync(resolve(output, "heap-operations.bin.gz"), compressed)
  writeFileSync(
    resolve(output, "heap-manifest.json"),
    JSON.stringify(
      {
        referenceRevision: revision,
        operations: 8200,
        bytes: bytes.length,
        compressedBytes: compressed.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        compressedSha256: createHash("sha256").update(compressed).digest("hex"),
      },
      null,
      2,
    ) + "\n",
  )
}
