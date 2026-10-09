import { parseArgs } from "node:util"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { createHash } from "node:crypto"
import { HighDensitySolverA13 } from "../lib"
import node from "../fixtures/srj18/cmn_4__sub_2_0.json"

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    baseline: { type: "string" },
    greedy: { type: "string", default: "1.1" },
    repeats: { type: "string", default: "3" },
    output: { type: "string" },
  },
})
if (!values.baseline)
  throw new Error("Pass --baseline /path/to/baseline/HighDensitySolverA13.ts")
const greedyMultiplier = Number(values.greedy)
if (!Number.isFinite(greedyMultiplier) || greedyMultiplier <= 0)
  throw new Error("greedy must be positive and finite")
const repeats = Number(values.repeats)
if (!Number.isInteger(repeats) || repeats < 1)
  throw new Error("repeats must be a positive integer")
const Baseline = (await import(pathToFileURL(resolve(values.baseline)).href))
  .HighDensitySolverA13 as typeof HighDensitySolverA13
function run(Solver: typeof HighDensitySolverA13, seed: number) {
  const start = performance.now()
  const s = new Solver({
    nodeWithPortPoints: node,
    hyperParameters: { shuffleSeed: seed, greedyMultiplier },
  })
  s.solve()
  const ms = performance.now() - start
  if (!s.solved || s.violations.length)
    throw new Error(`Seed ${seed} failed: ${s.error}`)
  return {
    ms,
    rounds: s.round,
    expansions: s.routingIterations,
    hash: createHash("sha256")
      .update(JSON.stringify(s.getOutput()))
      .digest("hex"),
  }
}
// Warm both implementations before timing. Run sequentially and alternate order
// so they do not compete for CPU and neither always gets the first slot.
run(Baseline, 0)
run(HighDensitySolverA13, 0)
const trials: Array<{
  repeat: number
  seed: number
  beforeMs: number
  afterMs: number
  rounds: number
  expansions: number
  hash: string
}> = []
for (let repeat = 0; repeat < repeats; repeat++)
  for (const seed of [0, 1, 2, 3, 4]) {
    let before, after
    if ((repeat + seed) % 2 === 0) {
      before = run(Baseline, seed)
      after = run(HighDensitySolverA13, seed)
    } else {
      after = run(HighDensitySolverA13, seed)
      before = run(Baseline, seed)
    }
    if (
      before.hash !== after.hash ||
      before.rounds !== after.rounds ||
      before.expansions !== after.expansions
    )
      throw new Error(`Routing changed for seed ${seed}`)
    const trial = {
      repeat,
      seed,
      beforeMs: before.ms,
      afterMs: after.ms,
      rounds: after.rounds,
      expansions: after.expansions,
      hash: after.hash,
    }
    trials.push(trial)
    console.log(JSON.stringify(trial))
  }
const median = (a: number[]) => {
  a.sort((a, b) => a - b)
  return a[Math.floor(a.length / 2)]!
}
const seeds = [0, 1, 2, 3, 4].map((seed) => {
  const t = trials.filter((t) => t.seed === seed)
  const beforeMs = median(t.map((t) => t.beforeMs)),
    afterMs = median(t.map((t) => t.afterMs))
  return { seed, beforeMs, afterMs, speedup: beforeMs / afterMs }
})
const result = {
  runtime: Bun.version,
  greedyMultiplier,
  repeats,
  seeds,
  aggregateSpeedup:
    seeds.reduce((n, s) => n + s.beforeMs, 0) /
    seeds.reduce((n, s) => n + s.afterMs, 0),
  identicalGeometry: true,
  trials,
}
console.log(JSON.stringify(result, null, 2))
if (values.output)
  await Bun.write(values.output, JSON.stringify(result, null, 2))
