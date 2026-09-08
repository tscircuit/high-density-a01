# A03 ABI v1 — implemented contract

The exports below are implemented by `src/wasm.rs` and the separate generated `a03SearchWasmBytes.ts` asset. The TypeScript bridge selects the optional backend on the first search and retains the original scheduling and finalization boundaries. A01 source and bytes remain unchanged.

## Module isolation and imports

A separate `a03_exact_search` WASM asset and compiled-module/instance pool; no change to A01 bytes or instance costs. Module imports:

- `a03_host.hypot(dx: f64, dy: f64) -> f64`: exact captured standard same-engine Math.hypot. Production caches only this returned distance in FIFO goal tables with at most 65,536 total slots (25 numeric bytes/slot). Every lookup recomputes the current dx/dy and compares same-value semantics (signed zero distinct, all NaNs equal). Via/greedy values remain live. The `uncached-distance-oracle` Cargo feature exists only for exact original host-call-order controls.
- `a03_host.footprint(cell: i32, destination: u32, capacity: u32) -> u32`: call the owner's original lazy getViaFootprint, copy its ordered Int32 IDs into the supplied WASM scratch, return length. Capacity is at least planeSize; no reentry, async work, or memory growth from the host. The callback context must drop its owner before idle pooling. Cached native footprint eviction reimports the existing TS memo rather than recomputing geometry.

Imports can throw. They must not be wrapped as capability failures or retried. Unsupported custom callbacks select/materialize JS before entering a pop.

## Input arrays: stable kind IDs

`a03_pointer(kind: u32) -> u32`, `a03_length(kind: u32) -> u32`. Length is element count, not bytes. Views must be refreshed after any allocating export. Input buffers belong to WASM and remain private; the bridge copies public graph arrays each guarded quantum, not replaces them with WASM views.

| Kind | Element type | Length | Data |
|---|---|---|---|
|1|f64|P|cellCenterX|
|2|f64|P|cellCenterY|
|3|i32|P+1|neighborOffset|
|4|i32|E|neighborIds|
|5|f32|E|neighborCosts|
|6|u8|P|viaAllowed|
|7|i32|S|primary owners|
|8|i32|S|fixed port owners|
|9|i32|S+1|shared owner offsets|
|10|i32|N|shared owner IDs in original order|
|11|f64|P|penalty2d|
|12|u8|C|rootOverlapAllowed|
|20|u32|S|visitedStamp (copy/read/export)|
|21|u32|S|visitedFlatStamp (copy/read/export)|
|22|u32|S|bestGStamp (copy/read/export)|
|23|f64|S|bestGValue (copy/read/export)|
|30|u32|8|published status/counters, below|
|31|i32|2*goalLength|goal chain interleaved z,cell from start to end|
|32|i32|goalRipLength|goal rip IDs in persistent-head traversal order|
|33|u32|4|distance cache slots, table count, hits, misses|
|40|u64|snapshotWords|versioned complete search materialization state, below|
|41|u64|distanceWords|versioned distance-cache materialization state, below|

Kinds 20–23 exist only after a successful begin. These buffers expose the current native search stamps and values. The integration attempts native only on the first search; once it declines, it stays in JavaScript until setup is reset. It does not adopt a later JavaScript search. Input pointers can change after an allocating export and must be reacquired.

P=plane cells, S=P*layers, E=CSR edge count, N=shared IDs, C=root mask length. Setup bounds P>0, layers>0, S<=1,048,576 and all array sizes/CSR/IDs, finite cellCenterX/Y values, and non-NaN Float32 edge values before any native pop. Invalid initial input is a capability result, not an earlier routing exception. Live numeric costs may include NaN, infinities and negative values, with the original arithmetic order. Nonfinite centers and NaN Float32 edges are capability rejections before a pop, because their typed-read NaN payload behavior can differ between JavaScript and native arithmetic.

## Exports

- `a03_abi_version() -> u32`: 1.
- `a03_setup(P, layers, E, N, C: u32) -> u32`: allocate/reset arrays and caches for one solver, return 1 if dimensions supported, 0 otherwise. Host then fills input arrays.
- `a03_resize_shared(N: u32)`: allocate the next search's shared-owner ID array only; refresh views before writes.
- `a03_validate_inputs() -> u32`: validate current graph/array contents without consuming any pop; return 1/0. The bridge must materialize JS for unsupported live replacements, not throw a routing error or restart a search.
- `a03_begin(stamp:u32, active:i32, startZ:i32, startCell:i32, endZ:i32, endCell:i32, startF:f64, clearStamps:u32, via:f64, rip:f64, traceRip:f64, viaRip:f64, greedy:f64, cap:f64) -> u32`: TS already performed original start H computation and owns iteration/budget setup. Reset heap/node/rip/whole-query cache; keep footprints; initialize exact node0, best-G and priority. clearStamps reproduces the explicit wrap-clearing step. Return 1/0 before any pop.
- `a03_seed_distance(goal:u32, cell:u32, dx:f64, dy:f64, distance:f64) -> u32`: after a successful begin and before the first pop, mirror the completed original TypeScript start-heuristic cache slot. Apply the same FIFO allocation rule; repeated identical seeds are idempotent and do not change hit/miss diagnostics. Invalid IDs, disabled capacity or absent kernel return 0 without changing state.
- `a03_export_distance_cache()`: prepare kind41 without changing kind40 or consuming search work. Refresh views after this allocating export.
- `a03_advance(via:f64, rip:f64, traceRip:f64, viaRip:f64, greedy:f64, cap:f64) -> u32`: consume one ordinary pop, return 0=advanced, 1=goal, 2=empty. No TS finalization, requeue, budget or public iteration changes here.
- `a03_advance_many(limit:u32, same six costs) -> u32`: consume only complete nonterminal pops, stop before empty/unvisited goal, return completed count. Duplicate pops count. Caller clamps search/global budgets and uses original step on zero.
- `a03_publish_state()`: update status/heap/pool/rip diagnostics from current partial state without advancing or allocating. Use after a thrown import once the WASM call has unwound.
- `a03_collect_goal()`: prepare kind31/32 arrays for unchanged TS finalizer. Does not clear residual heap/state.
- `a03_export_snapshot()`: prepare kind40 complete materialization words; no algorithm step. Refresh views afterward.
- `a03_clear()`: clear the entire solver state, input arrays, footprint copies, occupancy lists, snapshots, and scratch for release/setup; no ownership registry. `begin` instead keeps footprint geometry across searches and resets only active whole-query occupancy lists, with the original stamp lifecycle for per-cell lists. The TS bridge preserves public heap/visited diagnostics before release.

Kind30 (u32[8]): 0=last returned status, 1=current heap size, 2=goal node ID (i32 bits; -1 before goal), 3=attempts in last advance/bulk call, 4=completed pops in that call, 5=node-pool length, 6=rip-pool length, 7=stamp. Attempts/completed must be volatile-published at original boundaries in a WASM adapter. An import throw leaves attempts including the current failed pop and completed excluding it. Unlike a completed-count convention, original A03 openSet reads the current partially mutated heap: the bridge must call a03_publish_state after unwind for that value. The core snapshot retains the actual partial arrays.

## Materialization payload

Kind40 is a u64-word schema with explicit version and lengths, no dependence on Rust struct layout or pointer offsets. Integer values use low 32-bit two's-complement bits; f64 values retain raw IEEE bits. Fields in order:

1. version1; heap n, capacity; all backing entries (f bits, ID).
2. node n, capacity; all nodes (z, cell, g bits, parent, ripHead, ripCount).
3. rip n, capacity; all entries (connection ID, previous head).
4. length-prefixed visited, visitedFlat, bestStamp, bestG bits arrays.
5. moveCost bits, moveHead, moveRipCount bits; length-prefixed via/trace/layer scratch lists.
6. insertion-ordered whole-query list map and footprint list map (count, then key, length, IDs).
7. layer-cache length, then stamp, presence flag, length/IDs when present for each cell.

Search metadata, costs and the public TS counters are held by the bridge separately. The payload preserves all live IDs and old backing values for the frozen oracle; goal handoff can use the much smaller chain exports. Materialize the complete state on backend changes before the affected pop, continuing the original TS suffix without repeating already-executed search-iteration/budget work. No attempt to recover from a trap belongs in this capability path.

## Additive distance-cache payload

Kind41 is a separate u64-word payload. It does not change kind40. Its header is `[version=1, fixedCapacity, totalSlots, tableCount]`. Fixed capacity is P when `1 <= P <= 65,536`, otherwise 0. Tables appear in insertion/FIFO order. Each table contains `[goalCellId, length]`, then all dx words, all dy words, all distance words and all validity words. Floating words retain raw IEEE bits, including unused zero slots; validity bytes and integer fields use low32 bits with high32 zero.

The exported lengths sum to totalSlots, bounded by 65,536. Begin retains these tables, and each TypeScript-computed start slot is seeded before a native pop. Materialization uses the complete surviving FIFO list to remove evicted TypeScript goals and restore table contents/accounting. The original Map and surviving table identities remain observable after fallback. Setup/release clears the cache and exported buffers. The production ABI has no arbitrary whole-search snapshot import; Rust `Kernel::restore` exists only for the frozen search controls.
