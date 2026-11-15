# A13: negotiated congestion at 1×

A13 uses a fixed-size, multi-layer grid with negotiated congestion.

## Routing algorithm

1. Route each connection with weighted A*, keeping all provisional routes. A search excludes its own net from the cost field and replaces only its own route after finding a new path.
2. Other routes contribute soft congestion costs. Foreign terminals are fixed constraints; vias must stay inside the configured border inset. Trace and via footprints account for copper dimensions and the requested clearance.
3. At the end of a round, identify contested grid space and run the independent physical geometry checker. Increase historical costs on contested space and gradually increase present congestion cost.
4. Reroute conflicted connections individually. After eight rounds without improvement, allow every connection to renegotiate its path, halving present congestion cost while retaining history and provisional routes. This lets otherwise valid neighbors yield needed corridors.
5. Report success only when every connection is present and the independent geometry checker finds no crossings or clearance violations. For that check, trace widths and via diameters are inflated by `traceMargin`, enforcing that amount of additional copper clearance. The physical check is authoritative over conservative grid conflict flags.

The search uses Manhattan moves with a mild layer-direction preference and layer transitions. Exact terminal coordinates are connected by short leads. Collinear path compression removes redundant points, and occupancy is reconstructed from the emitted geometry rather than discarded grid points. Vias remain continuous across layer transitions; no route is stretched or scaled.

Defaults: grid pitch at most 0.1 mm, trace width 0.1 mm, via diameter 0.3 mm, clearance 0.1 mm, weighted-A* heuristic 1.2, 200 negotiation rounds, and 50 million search expansions. The heuristic is deliberately close to ordinary A*. Grid pitch adjusts slightly so its limits coincide with the original node boundaries.

## Debugger

```sh
bun install
bun run start
```

Select the `srj18/a13-via-spread` fixture in Cosmos to open A13 in GenericSolverDebugger.

Click **Solve** for the result, or reload the fixture and click **Animate** to watch provisional routes negotiate. Amber markers show geometry conflicts from the last completed round. The live status distinguishes provisional routes from validated completion. Search work is batched into 1,000 queue pops per debugger step; stale entries do not count as search expansions.

## Results and reproducibility

The unchanged SRJ18 sample 2 node `cmn_4__sub_2_0` has 26 connections in 12.7425 × 10.6167 mm. Its captured input comes from autorouter revision `2b24a39e585fb9f1a642d1a7f7432de81c219b68`, with root net names normalized using that capture's connectivity map.

Five independent ordering seeds all completed at 1× with zero physical geometry violations at the configured clearance:

| Seed | Rounds | Search expansions | Local standalone time |
| --- | ---: | ---: | ---: |
| 0 | 34 | 4,079,934 | 2.51 s |
| 1 | 11 | 2,801,118 | 1.44 s |
| 2 | 25 | 3,768,696 | 2.18 s |
| 3 | 71 | 7,452,422 | 5.09 s |
| 4 | 127 | 9,473,422 | 6.89 s |

Times are one sequential local Bun run, not a same-machine CI benchmark or guaranteed runtime. The browser independently completed seed 0 in 2.645 s. Existing dataset01 sample008 also completed its ten connections at 1× in two rounds.

```sh
bun scripts/check-a13.ts --seed 0 --output /tmp/a13-result.json
bun scripts/check-a13.ts --seed 4 --rounds 200 --budget 50000000
BUN_UPDATE_SNAPSHOTS=1 bun test --timeout 60000 tests/a13 tests/routeGeometryValidation.test.ts
bun run build
```

Tests cover five-seed hard-node completion, physical clearances, unchanged input bounds, exact terminals and metadata, via continuity, non-contiguous layer IDs, another existing node, and rejection of an unresolved single-layer crossing while retaining provisional routes.

These are isolated-node results. A13 is not yet integrated into the autorouter production pipeline, and a full-board DRC/benchmark comparison has not been run. Five successful seeds and one additional node provide regression coverage, not proof of reliability on every high-density node.

## Performance optimization

Compared with the original A13 implementation (`1a4a391`, merged unchanged as `0c95b5f`), A13 now reuses a typed-array search heap, caches exact heuristic values per search and via-border eligibility per grid, and retains route footprint sets rather than rebuilding them for every route pair. Search costs, heap tie ordering, negotiation policy, and geometry acceptance are unchanged.

Sequential local Bun 1.4.1 comparison: warm both implementations, alternate before/after order, and take the median of three trials per seed. Every paired trial checks output SHA-256, search expansions, and round count for exact equality. All 15 comparisons matched.

| Seed | Before median | After median | Speedup |
| --- | ---: | ---: | ---: |
| 0 | 2.414 s | 1.127 s | 2.14× |
| 1 | 1.376 s | 0.648 s | 2.13× |
| 2 | 2.115 s | 0.954 s | 2.22× |
| 3 | 4.666 s | 2.068 s | 2.26× |
| 4 | 7.467 s | 3.096 s | 2.41× |

The ratio of summed per-seed medians is **2.29×**. These are local isolated-node measurements, not full-board or CI performance claims. Raw measurements are in [a13-performance.json](./a13-performance.json).

Reproduce against the original implementation (the temporary source must sit beside the solver so its relative imports resolve):

```sh
git show 0c95b5f:lib/routeGeometryValidation.ts > lib/.benchmark-geometry.ts
git show 0c95b5f:lib/HighDensitySolverA13/HighDensitySolverA13.ts | sed 's|"../routeGeometryValidation"|"../.benchmark-geometry"|' > lib/HighDensitySolverA13/.benchmark-baseline.ts
bun scripts/benchmark-a13-performance.ts --baseline lib/HighDensitySolverA13/.benchmark-baseline.ts --repeats 3 --output /tmp/a13-performance.json
rm lib/HighDensitySolverA13/.benchmark-baseline.ts lib/.benchmark-geometry.ts
```

## Second performance optimization (relative to PR #115)

The second optimization moves only the A* search loop into a synchronous WebAssembly kernel. Routing policy, congestion negotiation, physical clearances, queue ordering, and the 1.1 heuristic are unchanged. It uses 64-bit costs with reassociation and fused operations disabled, caches static grid topology, and uses per-state versions to recognize stale heap entries. This reduces each queue entry to 16 bytes. Each solver has its own linear memory; only the compiled module is shared. Heap growth preserves the queue and refreshes JavaScript views after memory growth.

The TypeScript router caches unchanged route-pair findings and per-goal heuristics (bounded to 8 MiB). It replays findings in the original layer/pair order so negotiation remains deterministic. Geometry checking now skips segment pairs whose bounding boxes prove adequate clearance and constructs per-layer geometry once per route. Candidates still go through the existing exact distance checks and tolerances.

Against `cdfd68a` (merged PR #115), three warmed, alternating, sequential local Bun 1.4.1 trials per seed gave:

| Seed | PR #115 median | New median | Speedup |
| --- | ---: | ---: | ---: |
| 0 | 1.071 s | 0.527 s | 2.03× |
| 1 | 0.614 s | 0.316 s | 1.95× |
| 2 | 0.901 s | 0.451 s | 2.00× |
| 3 | 1.940 s | 0.948 s | 2.05× |
| 4 | 2.892 s | 1.283 s | 2.25× |

The ratio of summed medians is **2.10×**, on top of the previous optimization. Every paired run had identical output SHA-256, negotiation rounds, and search expansions. All five seeds still route at 1× with zero configured-clearance violations. Raw measurements are in [a13-performance-v2.json](./a13-performance-v2.json). These results describe this isolated node on this machine, not a guaranteed speedup on every input or runtime.

In the PR #116 baseline, `searchBackend` accepts `"auto"` (default), `"wasm"`, or `"javascript"`. Auto falls back to the original JS search if WebAssembly/SIMD is unavailable or blocked by CSP. The fallback retains the TypeScript caching and geometry improvements, but the 2.10× result uses WebAssembly. Forced WASM reports initialization failures instead of silently falling back. Solve, Step, and Animate remain synchronous and use the same debugger step boundaries and search budget.

Tests compare both backends at each debugger step, including fractional step/budget values, non-contiguous layers, an exhausted frontier, and blocked-WASM fallback. The hard-node parity test checks every round's cached findings against a fresh full geometry check, including ordering, and exercises heap growth. The geometry changes also produced identical ordered results to PR #115 on 500 deterministic randomized multilayer route sets; boundary tests cover trace, via/trace, and via/via clearance on both axes.

To reproduce, pin both baseline source files so it does not accidentally use the new geometry checker:

```sh
git show cdfd68a:lib/routeGeometryValidation.ts > lib/.benchmark-geometry.ts
git show cdfd68a:lib/HighDensitySolverA13/HighDensitySolverA13.ts | sed 's|"../routeGeometryValidation"|"../.benchmark-geometry"|' > lib/HighDensitySolverA13/.benchmark-baseline.ts
bun scripts/benchmark-a13-performance.ts --baseline lib/HighDensitySolverA13/.benchmark-baseline.ts --repeats 3 --output /tmp/a13-performance-v2.json
rm lib/HighDensitySolverA13/.benchmark-baseline.ts lib/.benchmark-geometry.ts
```

### Rebuilding the search kernel

Normal package builds use the checked-in `kernel.generated.ts`; no C compiler, fetch, worker, or additional runtime dependency is required. The generated module comes from the readable [kernel.c](../lib/HighDensitySolverA13/search/kernel.c). Editing it requires LLVM clang with the wasm32 target and `wasm-ld`:

```sh
# Set A13_CLANG/A13_WASM_LD if these are not the default binaries on PATH.
A13_CLANG=/path/to/llvm/clang A13_WASM_LD=/path/to/wasm-ld bun scripts/build-a13-kernel.ts
BUN_UPDATE_SNAPSHOTS=1 bun test tests/a13/search-backends.test.ts tests/a13/hard-node.test.ts
```

The recorded compiler was LLVM 22.1.8. Keep `-ffp-contract=off`, do not enable fast-math, and regenerate the checked-in module whenever the C source changes. The binary uses standard wasm32 SIMD; unsupported runtimes take the JS fallback. Additional memory includes the per-solver search buffers and bounded heuristic cache, traded for fewer repeated calculations and smaller priority-queue entries.

## C-to-JavaScript experiment

This follow-up branch makes `searchBackend: "auto"` and `"javascript"` use [JavascriptSearchKernel.ts](../lib/HighDensitySolverA13/search/JavascriptSearchKernel.ts), a close translation of the C kernel. Neither path compiles or instantiates WebAssembly. Explicit `"wasm"` remains available for direct comparison, with the C source and generated module unchanged. The older pre-WASM JS search loop has been removed so both backends now share the same begin/run/copyParents interface.

The translation preserves `configure` topology flags, `push`/`pop` comparisons, stale-entry versions, the nonnegative-cost early rejection, left/right/down/up/via visitation, operation order, and debugger chunk/budget boundaries. JavaScript numbers preserve the C double arithmetic. Constructor closures replace the C module's private globals; scalar return fields replace temporary C structs to avoid per-pop object allocation. Heap priority/index/version fields use Float64Array/Int32Array/Uint32Array arrays (16 bytes per entry in total). A literal packed-buffer translation was also tried; separate arrays performed better locally while preserving every comparison and queue operation. Search inputs are referenced rather than copied because the router does not mutate them while that search is active.

**The full WASM gain is not retained.** Two separate warmed, alternating, sequential comparisons on Bun 1.4.1, each with three trials per seed:

| Seed | WASM median | JS median (vs WASM) | Pre-WASM PR #115 median | JS median (vs PR #115) |
| --- | ---: | ---: | ---: | ---: |
| 0 | 0.570 s | 0.944 s | 1.231 s | 1.007 s |
| 1 | 0.341 s | 0.623 s | 0.756 s | 0.661 s |
| 2 | 0.496 s | 0.863 s | 1.035 s | 0.893 s |
| 3 | 1.026 s | 1.752 s | 2.238 s | 1.855 s |
| 4 | 1.435 s | 2.302 s | 3.322 s | 2.378 s |

The summed-median ratios show **1.68× the WASM runtime** (about 68% longer) and **1.26× faster than pre-WASM PR #115**. All 30 paired runs retained identical geometry SHA-256, rounds, and expansions, with all five seeds routing at 1× and zero configured-clearance violations. These are local isolated-node measurements, not a guarantee for other engines or inputs. The two comparisons ran separately, so their JS times are reported separately rather than mixing measurements across runs.

Raw measurements: [JS vs WASM](./a13-javascript-vs-wasm.json) and [JS vs PR #115](./a13-javascript-vs-pr115.json). This is an experimental default for evaluating the translation, not evidence that replacing WASM is performance-neutral. Backend parity tests compare every debugger step and provisional route change, verify each round's exact ordered DRC findings, and assert that the default path never attempts WASM initialization.

Reproduce with isolated baseline files (both baseline revisions must be available locally):

```sh
wasm_baseline=$(mktemp -d)
js_baseline=$(mktemp -d)
git archive 3aedab6 lib | tar -x -C "$wasm_baseline"
git archive cdfd68a lib | tar -x -C "$js_baseline"
ln -s "$PWD/node_modules" "$wasm_baseline/node_modules"
ln -s "$PWD/node_modules" "$js_baseline/node_modules"
bun scripts/benchmark-a13-performance.ts --baseline "$wasm_baseline/lib/HighDensitySolverA13/HighDensitySolverA13.ts" --repeats 3 --output /tmp/js-vs-wasm.json
bun scripts/benchmark-a13-performance.ts --baseline "$js_baseline/lib/HighDensitySolverA13/HighDensitySolverA13.ts" --repeats 3 --output /tmp/js-vs-pr115.json
rm -r "$wasm_baseline" "$js_baseline"
```

## Greedy multiplier tuning

The current default greedy/heuristic multiplier is **1.2**, increased from 1.1. The JavaScript backend remains the default. Geometry validation, physical dimensions, search budget, and round limit are unchanged. Unlike the kernel translation, this intentionally changes search order and can change the resulting routes.

A sweep of 1.1, 1.12, 1.15, 1.2, 1.25, 1.3, 1.4, 1.5, 1.6, 1.75, 2, 3, and 4.5 showed that more greed is not consistently better. Values 1.75, 2, 3, and 4.5 failed at least one ordering seed within the original limits. The strongest moderate candidates were then compared on JavaScript, rotating execution order over three warmed trials per seed:

| Seed | 1.1 median | 1.2 median | 1.3 median |
| --- | ---: | ---: | ---: |
| 0 | 0.917 s | 0.664 s | 0.471 s |
| 1 | 0.588 s | 0.832 s | 0.331 s |
| 2 | 0.820 s | 0.857 s | 1.625 s |
| 3 | 1.795 s | 1.763 s | 0.424 s |
| 4 | 2.350 s | 1.130 s | 2.591 s |

At 1.2 the ratio of summed per-seed median times is **1.23×** versus 1.1. The fixture's seed 0 improves **1.38×**, from 0.917 s to 0.664 s; negotiation rounds fall from 34 to 18. All five seeds solve at 1× with zero violations in a fresh, full configured-clearance geometry check. Seed 1 is slower (0.588 s to 0.832 s), so this is an overall improvement, not a per-seed guarantee. At 1.3 the displayed seed is faster still, but aggregate time is worse than 1.2 and some other seeds regress substantially. Raw trials are in [a13-greedy-tuning.json](./a13-greedy-tuning.json).

Historical WASM/JavaScript comparisons above used **1.1**. `benchmark-a13-performance.ts` explicitly uses 1.1 for both implementations by default, preserving an identical-policy comparison across revisions; pass `--greedy` to change it. `check-a13.ts` follows the solver's current default when `--greedy` is omitted and reports the effective multiplier:

```sh
bun scripts/check-a13.ts --seed 0
bun scripts/check-a13.ts --seed 0 --greedy 1.1
bun scripts/check-a13.ts --seed 0 --greedy 1.3
```
