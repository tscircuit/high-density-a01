# A13: negotiated congestion at 1×

A13 uses a fixed-size, multi-layer grid with negotiated congestion.

## Routing algorithm

1. Route each connection with weighted A*, keeping all provisional routes. A search excludes its own net from the cost field and replaces only its own route after finding a new path.
2. Other routes contribute soft congestion costs. Foreign terminals are fixed constraints; vias must stay inside the configured border inset. Trace and via footprints account for copper dimensions and the requested clearance.
3. At the end of a round, identify contested grid space and run the independent physical geometry checker. Increase historical costs on contested space and gradually increase present congestion cost.
4. Reroute conflicted connections individually. After eight rounds without improvement, allow every connection to renegotiate its path, halving present congestion cost while retaining history and provisional routes. This lets otherwise valid neighbors yield needed corridors.
5. Report success only when every connection is present and the independent geometry checker finds no crossings or clearance violations. For that check, trace widths and via diameters are inflated by `traceMargin`, enforcing that amount of additional copper clearance. The physical check is authoritative over conservative grid conflict flags.

The search uses Manhattan moves with a mild layer-direction preference and layer transitions. Exact terminal coordinates are connected by short leads. Collinear path compression removes redundant points, and occupancy is reconstructed from the emitted geometry rather than discarded grid points. Vias remain continuous across layer transitions; no route is stretched or scaled.

Defaults: grid pitch at most 0.1 mm, trace width 0.1 mm, via diameter 0.3 mm, clearance 0.1 mm, weighted-A* heuristic 1.1, 200 negotiation rounds, and 50 million search expansions. The heuristic is deliberately close to ordinary A*. Grid pitch adjusts slightly so its limits coincide with the original node boundaries.

## Debugger

```sh
bun install
bun run start
```

Select the `srj18/a13-via-spread` fixture in Cosmos to open A13 in GenericSolverDebugger.

Click **Solve** for the result, or reload the fixture and click **Animate** to watch provisional routes negotiate. Amber markers show geometry conflicts from the last completed round. The live status distinguishes provisional routes from validated completion. Search work is batched into 1,000 expansions per debugger step.

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
