//! Exact A03 search core with a separate synchronous WASM adapter.
//! TypeScript retains all budgets, setup, finalization and capability selection.

pub const MAX_STATES: usize = 1_048_576;
pub const MAX_LAYER_CACHE_CELLS: usize = 65_536;

#[derive(Clone, Debug)]
pub struct Problem {
    pub plane: usize,
    pub layers: usize,
    pub x: Vec<f64>,
    pub y: Vec<f64>,
    pub offsets: Vec<i32>,
    pub neighbors: Vec<i32>,
    pub edge_costs: Vec<f32>,
    pub via_allowed: Vec<u8>,
    pub owners: Vec<i32>,
    pub port_owners: Vec<i32>,
    pub shared_offsets: Vec<i32>,
    pub shared_ids: Vec<i32>,
    pub penalties: Vec<f64>,
    pub root_overlap: Vec<u8>,
}

impl Problem {
    /// Revalidate only fields copied before each pop/quantum. Owners and shared
    /// occupancy are unchanged during a search and retain full begin validation.
    pub fn validate_graph(&self) -> Result<(), &'static str> {
        let states = self
            .plane
            .checked_mul(self.layers)
            .ok_or("state overflow")?;
        if self.plane == 0 || self.layers == 0 || states > MAX_STATES {
            return Err("unsupported grid dimensions");
        }
        if self.x.len() != self.plane
            || self.y.len() != self.plane
            || self.via_allowed.len() != self.plane
            || self.penalties.len() != self.plane
            || self.owners.len() != states
            || self.port_owners.len() != states
            || self.edge_costs.len() != self.neighbors.len()
        {
            return Err("array dimensions");
        }
        if self.x.iter().chain(&self.y).any(|v| !v.is_finite()) {
            return Err("unsupported nonfinite centers");
        }
        if self.offsets.len() != self.plane + 1
            || self.offsets[0] != 0
            || self.offsets[self.plane] as usize != self.neighbors.len()
            || !self.offsets.windows(2).all(|p| p[0] >= 0 && p[0] <= p[1])
            || self.shared_offsets.len() != states + 1
            || self.shared_offsets[0] != 0
            || self.shared_offsets[states] as usize != self.shared_ids.len()
            || self
                .neighbors
                .iter()
                .zip(&self.edge_costs)
                .any(|(&id, &cost)| id < 0 || id as usize >= self.plane || cost.is_nan())
        {
            return Err("unsupported CSR");
        }
        Ok(())
    }

    /// Initial capability validation only. A future bridge must materialize JS
    /// before unsupported live inputs; this is not an earlier routing error.
    pub fn validate(&self) -> Result<(), &'static str> {
        let states = self
            .plane
            .checked_mul(self.layers)
            .ok_or("state overflow")?;
        if self.plane == 0 || self.layers == 0 || states > MAX_STATES {
            return Err("unsupported grid dimensions");
        }
        if self.x.len() != self.plane
            || self.y.len() != self.plane
            || self.via_allowed.len() != self.plane
            || self.penalties.len() != self.plane
            || self.owners.len() != states
            || self.port_owners.len() != states
            || self.edge_costs.len() != self.neighbors.len()
        {
            return Err("array dimensions");
        }
        // JavaScript Number reads canonicalize nonfinite typed-array payloads
        // on some engines. Preserve that path before a pop instead of guessing
        // how native subtraction should rewrite the observable memo backing.
        if self.x.iter().chain(&self.y).any(|v| !v.is_finite()) {
            return Err("unsupported nonfinite centers");
        }
        fn csr(offsets: &[i32], rows: usize, length: usize) -> bool {
            offsets.len() == rows + 1
                && offsets[0] == 0
                && offsets[rows] as usize == length
                && offsets.windows(2).all(|p| p[0] >= 0 && p[0] <= p[1])
        }
        if !csr(&self.offsets, self.plane, self.neighbors.len())
            || !csr(&self.shared_offsets, states, self.shared_ids.len())
            || self
                .neighbors
                .iter()
                .zip(&self.edge_costs)
                .any(|(&id, &cost)| id < 0 || id as usize >= self.plane || cost.is_nan())
        {
            return Err("unsupported CSR");
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Costs {
    pub via: f64,
    pub rip: f64,
    pub trace_rip: f64,
    pub via_rip: f64,
    pub greedy: f64,
    pub cap: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct Search {
    pub stamp: u32,
    pub active: i32,
    pub start_z: i32,
    pub start_cell: i32,
    pub end_z: i32,
    pub end_cell: i32,
}

/// Synchronous host boundary contract. `hypot` must return the current JS
/// engine's exact result, never sqrt or a Rust math approximation. Footprints
/// are requested only on their first actual query, in original execution order.
/// A WASM adapter must not re-enter the kernel or grow its memory from a host
/// callback. Host exceptions propagate after partial search writes, never retry.
pub trait Host {
    type Error;
    fn hypot(&mut self, dx: f64, dy: f64) -> Result<f64, Self::Error>;
    fn footprint(&mut self, cell: i32) -> Result<Vec<i32>, Self::Error>;
}

#[derive(Clone, Copy, Debug, Default)]
pub struct HeapEntry {
    pub f: f64,
    pub id: i32,
}

/// The full backing values are retained for frozen TS-state comparisons and
/// materialization. The comparisons and hole order are literal C37 A03 rules.
#[derive(Clone, Debug)]
pub struct Heap {
    pub entries: Vec<HeapEntry>,
    pub n: usize,
}
impl Default for Heap {
    fn default() -> Self {
        Self {
            entries: vec![HeapEntry::default(); 1024],
            n: 0,
        }
    }
}
impl Heap {
    pub fn clear(&mut self) {
        self.n = 0;
    }
    pub fn push(&mut self, f: f64, id: i32) {
        if self.n == self.entries.len() {
            self.entries
                .resize(self.entries.len() * 2, HeapEntry::default());
        }
        let mut i = self.n;
        self.n += 1;
        while i > 0 {
            let p = (i - 1) >> 1;
            let parent = self.entries[p];
            if if parent.f != f {
                parent.f < f
            } else {
                parent.id < id
            } {
                break;
            }
            self.entries[i] = parent;
            i = p;
        }
        self.entries[i] = HeapEntry { f, id };
    }
    pub fn pop(&mut self) -> i32 {
        assert!(self.n > 0);
        let out = self.entries[0].id;
        self.n -= 1;
        if self.n > 0 {
            let entry = self.entries[self.n];
            let mut i = 0;
            loop {
                let left = i * 2 + 1;
                if left >= self.n {
                    break;
                }
                let right = left + 1;
                let mut child = left;
                if right < self.n {
                    let a = self.entries[left];
                    let b = self.entries[right];
                    if !(if a.f != b.f { a.f < b.f } else { a.id < b.id }) {
                        child = right;
                    }
                }
                let next = self.entries[child];
                if if entry.f != next.f {
                    entry.f < next.f
                } else {
                    entry.id < next.id
                } {
                    break;
                }
                self.entries[i] = next;
                i = child;
            }
            self.entries[i] = entry;
        }
        out
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Node {
    pub z: i32,
    pub cell: i32,
    pub g: f64,
    pub parent: i32,
    pub rip_head: i32,
    pub rip_count: i32,
}
impl Default for Node {
    fn default() -> Self {
        Self {
            z: 0,
            cell: 0,
            g: 0.0,
            parent: 0,
            rip_head: -1,
            rip_count: 0,
        }
    }
}
#[derive(Clone, Debug)]
pub struct Pool {
    pub nodes: Vec<Node>,
    pub n: usize,
}
impl Default for Pool {
    fn default() -> Self {
        Self {
            nodes: vec![Node::default(); 1024],
            n: 0,
        }
    }
}
impl Pool {
    pub fn clear(&mut self) {
        self.n = 0;
    }
    pub fn push(&mut self, node: Node) -> i32 {
        if self.n == self.nodes.len() {
            self.nodes.resize(self.nodes.len() * 2, Node::default());
        }
        let id = self.n;
        self.n += 1;
        self.nodes[id] = node;
        id as i32
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Rip {
    pub owner: i32,
    pub prev: i32,
}
#[derive(Clone, Debug)]
pub struct RipChain {
    pub entries: Vec<Rip>,
    pub n: usize,
}
impl Default for RipChain {
    fn default() -> Self {
        Self {
            entries: vec![Rip { owner: 0, prev: -1 }; 1024],
            n: 0,
        }
    }
}
impl RipChain {
    pub fn clear(&mut self) {
        self.n = 0;
    }
    pub fn append(&mut self, prev: i32, owner: i32) -> i32 {
        if self.n == self.entries.len() {
            self.entries
                .resize(self.entries.len() * 2, Rip { owner: 0, prev: -1 });
        }
        let id = self.n;
        self.n += 1;
        self.entries[id] = Rip { owner, prev };
        id as i32
    }
    pub fn contains(&self, mut head: i32, owner: i32) -> bool {
        while head >= 0 {
            let node = self.entries[head as usize];
            if node.owner == owner {
                return true;
            }
            head = node.prev;
        }
        false
    }
}

#[derive(Clone, Debug)]
pub struct OrderedLists {
    pub entries: Vec<Option<Vec<i32>>>,
    pub order: Vec<i32>,
}
impl OrderedLists {
    fn new(size: usize) -> Self {
        Self {
            entries: vec![None; size],
            order: Vec::new(),
        }
    }
    fn insert(&mut self, key: i32, value: Vec<i32>) {
        if self.entries[key as usize].is_none() {
            self.order.push(key);
        }
        self.entries[key as usize] = Some(value);
    }
    fn clear(&mut self) {
        for &key in &self.order {
            self.entries[key as usize] = None;
        }
        self.order.clear();
    }
}

/// Complete mutable search data, including stale backing values needed by the
/// frozen oracle. Clone/export before changing backend; never restart a search.
#[derive(Clone, Debug)]
pub struct SearchState {
    pub heap: Heap,
    pub pool: Pool,
    pub rips: RipChain,
    pub visited: Vec<u32>,
    pub visited_flat: Vec<u32>,
    pub best_stamp: Vec<u32>,
    pub best_g: Vec<f64>,
    pub move_cost: f64,
    pub move_head: i32,
    pub move_rips: f64,
    pub via_scratch: Vec<i32>,
    pub trace_scratch: Vec<i32>,
    pub layer_scratch: Vec<i32>,
    pub via_lists: OrderedLists,
    pub footprints: OrderedLists,
    pub layer_lists: Vec<Option<Vec<i32>>>,
    pub layer_stamps: Vec<u32>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Advanced,
    Goal(i32),
    Empty,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BatchState {
    pub attempts: u32,
    pub completed: u32,
}

#[derive(Default)]
struct DistanceTable {
    dx: Vec<f64>,
    dy: Vec<f64>,
    values: Vec<f64>,
    valid: Vec<u8>,
}
#[derive(Default)]
pub struct DistanceCache {
    enabled: bool,
    tables: std::collections::HashMap<usize, DistanceTable>,
    order: std::collections::VecDeque<usize>,
    slots: usize,
    hits: u32,
    misses: u32,
}
impl DistanceCache {
    fn same_value(a: f64, b: f64) -> bool {
        a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan())
    }
    fn ensure_table(&mut self, size: usize, goal: usize) {
        if !self.tables.contains_key(&goal) {
            while self.slots + size > MAX_LAYER_CACHE_CELLS {
                let oldest = self.order.pop_front().expect("distance slot accounting");
                self.slots -= self.tables.remove(&oldest).unwrap().values.len();
            }
            self.tables.insert(
                goal,
                DistanceTable {
                    dx: vec![0.0; size],
                    dy: vec![0.0; size],
                    values: vec![0.0; size],
                    valid: vec![0; size],
                },
            );
            self.order.push_back(goal);
            self.slots += size;
        }
    }
    /// Mirror the already completed TypeScript start-heuristic cache write.
    /// Re-seeding an existing entry does not reorder it or change diagnostics.
    fn seed(
        &mut self,
        size: usize,
        goal: usize,
        cell: usize,
        dx: f64,
        dy: f64,
        distance: f64,
    ) -> bool {
        if !self.enabled
            || size == 0
            || size > MAX_LAYER_CACHE_CELLS
            || goal >= size
            || cell >= size
        {
            return false;
        }
        self.ensure_table(size, goal);
        let table = self.tables.get_mut(&goal).unwrap();
        table.dx[cell] = dx;
        table.dy[cell] = dy;
        table.values[cell] = distance;
        table.valid[cell] = 1;
        true
    }
    /// Additive materialization ABI41: fixed capacity and FIFO table order,
    /// followed by every backing float/validity slot, including unwritten zeros.
    fn words(&self, capacity: usize) -> Vec<u64> {
        let capacity = if capacity > 0 && capacity <= MAX_LAYER_CACHE_CELLS {
            capacity
        } else {
            0
        };
        let mut out = vec![
            1,
            capacity as u64,
            self.slots as u64,
            self.order.len() as u64,
        ];
        for &goal in &self.order {
            let table = &self.tables[&goal];
            out.extend([goal as u64, table.values.len() as u64]);
            for values in [&table.dx, &table.dy, &table.values] {
                out.extend(values.iter().map(|v| v.to_bits()));
            }
            out.extend(table.valid.iter().map(|&v| v as u64));
        }
        out
    }
    fn distance<H: Host>(
        &mut self,
        host: &mut H,
        size: usize,
        goal: usize,
        cell: usize,
        dx: f64,
        dy: f64,
    ) -> Result<f64, H::Error> {
        if !self.enabled
            || size == 0
            || size > MAX_LAYER_CACHE_CELLS
            || goal >= size
            || cell >= size
        {
            return host.hypot(dx, dy);
        }
        self.ensure_table(size, goal);
        let table = self.tables.get_mut(&goal).unwrap();
        if table.valid[cell] != 0
            && Self::same_value(table.dx[cell], dx)
            && Self::same_value(table.dy[cell], dy)
        {
            self.hits = self.hits.wrapping_add(1);
            return Ok(table.values[cell]);
        }
        // The table belongs to the kernel before the import. A thrown host
        // call leaves the old validity/value untouched and needs no Drop guard.
        self.misses = self.misses.wrapping_add(1);
        let value = host.hypot(dx, dy)?;
        table.dx[cell] = dx;
        table.dy[cell] = dy;
        table.values[cell] = value;
        table.valid[cell] = 1;
        Ok(value)
    }
}

#[derive(Clone, Debug)]
pub struct Snapshot {
    pub search: Search,
    pub costs: Costs,
    pub state: SearchState,
    pub batch: BatchState,
}

pub struct Kernel {
    pub distance_cache: DistanceCache,
    pub problem: Problem,
    pub search: Search,
    pub costs: Costs,
    pub state: SearchState,
    pub batch: BatchState,
}
impl Kernel {
    pub fn new(
        problem: Problem,
        costs: Costs,
        search: Search,
        start_f: f64,
    ) -> Result<Self, &'static str> {
        problem.validate()?;
        let cells = problem.plane * problem.layers;
        let plane = problem.plane;
        let layer_cache = problem.layers > 1 && plane <= MAX_LAYER_CACHE_CELLS;
        let mut kernel = Self {
            distance_cache: DistanceCache::default(),
            problem,
            search,
            costs,
            batch: BatchState::default(),
            state: SearchState {
                heap: Heap::default(),
                pool: Pool::default(),
                rips: RipChain::default(),
                visited: vec![0; cells],
                visited_flat: vec![0; cells],
                best_stamp: vec![0; cells],
                best_g: vec![0.0; cells],
                move_cost: 0.0,
                move_head: -1,
                move_rips: 0.0,
                via_scratch: Vec::new(),
                trace_scratch: Vec::new(),
                layer_scratch: Vec::new(),
                via_lists: OrderedLists::new(plane),
                footprints: OrderedLists::new(plane),
                layer_lists: vec![None; if layer_cache { plane } else { 0 }],
                layer_stamps: vec![0; if layer_cache { plane } else { 0 }],
            },
        };
        kernel.begin(search, start_f, false)?;
        Ok(kernel)
    }
    pub fn begin(
        &mut self,
        search: Search,
        start_f: f64,
        clear_stamps: bool,
    ) -> Result<(), &'static str> {
        if search.stamp == 0
            || search.active < 0
            || search.active as usize >= self.problem.root_overlap.len()
            || [search.start_z, search.end_z]
                .iter()
                .any(|&z| z < 0 || z as usize >= self.problem.layers)
            || [search.start_cell, search.end_cell]
                .iter()
                .any(|&c| c < 0 || c as usize >= self.problem.plane)
        {
            return Err("unsupported active search");
        }
        self.search = search;
        self.state.heap.clear();
        self.state.pool.clear();
        self.state.rips.clear();
        self.state.via_lists.clear();
        self.publish_batch(0, 0);
        if clear_stamps {
            self.state.visited.fill(0);
            self.state.visited_flat.fill(0);
            self.state.best_stamp.fill(0);
            self.state.layer_stamps.fill(0);
        }
        let id = self.state.pool.push(Node {
            z: search.start_z,
            cell: search.start_cell,
            g: 0.0,
            parent: -1,
            rip_head: -1,
            rip_count: 0,
        });
        let flat = self.flat(search.start_z, search.start_cell);
        self.state.best_stamp[flat] = search.stamp;
        self.state.best_g[flat] = 0.0;
        self.state.heap.push(start_f, id);
        Ok(())
    }
    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            search: self.search,
            costs: self.costs,
            state: self.state.clone(),
            batch: self.batch,
        }
    }
    /// Restoring an already validated native snapshot makes no search step.
    /// The eventual bridge must validate public replacement data separately.
    pub fn restore(problem: Problem, snapshot: Snapshot) -> Result<Self, &'static str> {
        problem.validate()?;
        let cells = problem.plane * problem.layers;
        if snapshot.state.visited.len() != cells
            || snapshot.state.visited_flat.len() != cells
            || snapshot.state.best_stamp.len() != cells
            || snapshot.state.best_g.len() != cells
            || snapshot.state.heap.n > snapshot.state.heap.entries.len()
            || snapshot.state.pool.n > snapshot.state.pool.nodes.len()
            || snapshot.state.rips.n > snapshot.state.rips.entries.len()
        {
            return Err("snapshot dimensions");
        }
        Ok(Self {
            distance_cache: DistanceCache::default(),
            problem,
            search: snapshot.search,
            costs: snapshot.costs,
            state: snapshot.state,
            batch: snapshot.batch,
        })
    }
    fn flat(&self, z: i32, cell: i32) -> usize {
        z as usize * self.problem.plane + cell as usize
    }
    fn push_unique(out: &mut Vec<i32>, owner: i32) {
        if !out.contains(&owner) {
            out.push(owner);
        }
    }
    fn push_flat(problem: &Problem, active: i32, flat: usize, out: &mut Vec<i32>) {
        let primary = problem.owners[flat];
        let friendly = |owner: i32| problem.root_overlap.get(owner as usize) == Some(&1);
        if primary != -1 && primary != active && !friendly(primary) {
            Self::push_unique(out, primary);
        }
        for i in problem.shared_offsets[flat] as usize..problem.shared_offsets[flat + 1] as usize {
            let owner = problem.shared_ids[i];
            if owner != active && !friendly(owner) {
                Self::push_unique(out, owner);
            }
        }
    }
    fn via_occupants<H: Host>(&mut self, host: &mut H, cell: i32) -> Result<(), H::Error> {
        let index = cell as usize;
        let cache_whole = self.problem.layers > 2;
        if cache_whole && self.state.via_lists.entries[index].is_some() {
            return Ok(());
        }
        if !cache_whole {
            self.state.via_scratch.clear();
        }
        if self.state.footprints.entries[index].is_none() {
            let footprint = host.footprint(cell)?;
            // The host contract supplies canonical original geometry, without
            // re-entrant mutation. An invalid host result is not a JS fallback.
            assert!(footprint
                .iter()
                .all(|&c| c >= 0 && (c as usize) < self.problem.plane));
            self.state.footprints.insert(cell, footprint);
        }
        let mut whole = Vec::new();
        let cells = self.state.footprints.entries[index].as_ref().unwrap().len();
        for i in 0..cells {
            let occ_cell = self.state.footprints.entries[index].as_ref().unwrap()[i] as usize;
            let use_layers = !self.state.layer_stamps.is_empty();
            if use_layers {
                if self.state.layer_stamps[occ_cell] != self.search.stamp {
                    self.state.layer_scratch.clear();
                    for z in 0..self.problem.layers {
                        Self::push_flat(
                            &self.problem,
                            self.search.active,
                            z * self.problem.plane + occ_cell,
                            &mut self.state.layer_scratch,
                        );
                    }
                    self.state.layer_lists[occ_cell] = Some(self.state.layer_scratch.clone());
                    self.state.layer_stamps[occ_cell] = self.search.stamp;
                }
                for &owner in self.state.layer_lists[occ_cell].as_ref().unwrap() {
                    Self::push_unique(
                        if cache_whole {
                            &mut whole
                        } else {
                            &mut self.state.via_scratch
                        },
                        owner,
                    );
                }
            } else {
                for z in 0..self.problem.layers {
                    Self::push_flat(
                        &self.problem,
                        self.search.active,
                        z * self.problem.plane + occ_cell,
                        if cache_whole {
                            &mut whole
                        } else {
                            &mut self.state.via_scratch
                        },
                    );
                }
            }
        }
        if cache_whole {
            self.state.via_lists.insert(cell, whole);
        }
        Ok(())
    }
    fn move_cost<H: Host>(
        &mut self,
        host: &mut H,
        z: i32,
        cell: i32,
        via: bool,
        ripped: i32,
        ripped_count: i32,
        lateral: f64,
    ) -> Result<(), H::Error> {
        let mut cost = 0.0;
        let mut head = ripped;
        let mut count = ripped_count as f64;
        let flat = self.flat(z, cell);
        let fixed = self.problem.port_owners[flat];
        if fixed >= 0
            && fixed != self.search.active
            && self.problem.root_overlap.get(fixed as usize) != Some(&1)
            && !(z == self.search.end_z && cell == self.search.end_cell)
        {
            self.state.move_cost = -1.0;
            self.state.move_head = head;
            // The original early rejection deliberately leaves move_rips stale.
            return Ok(());
        }
        if via {
            cost += self.costs.via;
            cost += js_min(self.problem.penalties[cell as usize], self.costs.cap);
            self.via_occupants(host, cell)?;
        } else {
            cost += lateral;
            cost += js_min(self.problem.penalties[cell as usize], self.costs.cap);
            self.state.trace_scratch.clear();
            Self::push_flat(
                &self.problem,
                self.search.active,
                flat,
                &mut self.state.trace_scratch,
            );
        }
        let length = if via {
            if self.problem.layers > 2 {
                self.state.via_lists.entries[cell as usize]
                    .as_ref()
                    .unwrap()
                    .len()
            } else {
                self.state.via_scratch.len()
            }
        } else {
            self.state.trace_scratch.len()
        };
        for i in 0..length {
            let owner = if via {
                if self.problem.layers > 2 {
                    self.state.via_lists.entries[cell as usize]
                        .as_ref()
                        .unwrap()[i]
                } else {
                    self.state.via_scratch[i]
                }
            } else {
                self.state.trace_scratch[i]
            };
            if !self.state.rips.contains(head, owner) {
                cost += self.costs.rip;
                head = self.state.rips.append(head, owner);
                count += 1.0;
            }
            cost += if via {
                self.costs.via_rip
            } else {
                self.costs.trace_rip
            };
        }
        self.state.move_cost = cost;
        self.state.move_head = head;
        self.state.move_rips = count;
        Ok(())
    }
    fn h<H: Host>(&mut self, host: &mut H, z: i32, cell: i32) -> Result<f64, H::Error> {
        let dx = self.problem.x[cell as usize] - self.problem.x[self.search.end_cell as usize];
        let dy = self.problem.y[cell as usize] - self.problem.y[self.search.end_cell as usize];
        let distance = self.distance_cache.distance(
            host,
            self.problem.plane,
            self.search.end_cell as usize,
            cell as usize,
            dx,
            dy,
        )?;
        Ok(if z == self.search.end_z {
            distance
        } else {
            distance + self.costs.via
        })
    }
    pub fn advance<H: Host>(&mut self, host: &mut H) -> Result<Status, H::Error> {
        if self.state.heap.n == 0 {
            return Ok(Status::Empty);
        }
        let id = self.state.heap.pop();
        let Node {
            z,
            cell,
            g,
            rip_head,
            rip_count,
            ..
        } = self.state.pool.nodes[id as usize];
        let flat = self.flat(z, cell);
        if self.state.visited[flat] == self.search.stamp {
            return Ok(Status::Advanced);
        }
        self.state.visited[flat] = self.search.stamp;
        self.state.visited_flat[flat] = self.search.stamp;
        if z == self.search.end_z && cell == self.search.end_cell {
            return Ok(Status::Goal(id));
        }
        let first = self.problem.offsets[cell as usize] as usize;
        let end = self.problem.offsets[cell as usize + 1] as usize;
        for i in first..end {
            let next = self.problem.neighbors[i];
            let key = self.flat(z, next);
            if self.state.visited[key] == self.search.stamp {
                continue;
            }
            self.move_cost(
                host,
                z,
                next,
                false,
                rip_head,
                rip_count,
                self.problem.edge_costs[i] as f64,
            )?;
            if self.state.move_cost < 0.0 {
                continue;
            }
            if self.state.visited[key] == self.search.stamp {
                continue;
            }
            let g2 = g + self.state.move_cost;
            if self.state.best_stamp[key] == self.search.stamp && g2 >= self.state.best_g[key] {
                continue;
            }
            self.state.best_stamp[key] = self.search.stamp;
            self.state.best_g[key] = g2;
            // Both best-G writes precede the possibly throwing host call.
            let f = g2 + self.h(host, z, next)? * self.costs.greedy;
            let next_id = self.state.pool.push(Node {
                z,
                cell: next,
                g: g2,
                parent: id,
                rip_head: self.state.move_head,
                rip_count: js_to_i32(self.state.move_rips),
            });
            self.state.heap.push(f, next_id);
        }
        if self.problem.via_allowed[cell as usize] != 0 {
            for nz in 0..self.problem.layers as i32 {
                if nz == z {
                    continue;
                }
                let key = self.flat(nz, cell);
                if self.state.visited[key] == self.search.stamp {
                    continue;
                }
                self.move_cost(host, nz, cell, true, rip_head, rip_count, 0.0)?;
                if self.state.move_cost < 0.0 {
                    continue;
                }
                if self.state.visited[key] == self.search.stamp {
                    continue;
                }
                let g2 = g + self.state.move_cost;
                if self.state.best_stamp[key] == self.search.stamp && g2 >= self.state.best_g[key] {
                    continue;
                }
                self.state.best_stamp[key] = self.search.stamp;
                self.state.best_g[key] = g2;
                let f = g2 + self.h(host, nz, cell)? * self.costs.greedy;
                let next_id = self.state.pool.push(Node {
                    z: nz,
                    cell,
                    g: g2,
                    parent: id,
                    rip_head: self.state.move_head,
                    rip_count: js_to_i32(self.state.move_rips),
                });
                self.state.heap.push(f, next_id);
            }
        }
        Ok(Status::Advanced)
    }
    /// Host exceptions leave the WebAssembly frame without Rust unwinding.
    /// Publish these counters before/after each attempted pop, even when an
    /// optimizer could otherwise combine stores across a throwing import.
    pub fn publish_batch(&mut self, attempts: u32, completed: u32) {
        #[cfg(target_arch = "wasm32")]
        unsafe {
            core::ptr::write_volatile(&mut self.batch.attempts, attempts);
            core::ptr::write_volatile(&mut self.batch.completed, completed);
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.batch = BatchState {
                attempts,
                completed,
            };
        }
    }
    pub fn advance_many<H: Host>(&mut self, host: &mut H, limit: u32) -> Result<u32, H::Error> {
        self.publish_batch(0, 0);
        for _ in 0..limit {
            if self.state.heap.n == 0 {
                break;
            }
            self.publish_batch(self.batch.completed + 1, self.batch.completed);
            let id = self.state.heap.entries[0].id;
            let node = self.state.pool.nodes[id as usize];
            let flat = self.flat(node.z, node.cell);
            if node.z == self.search.end_z
                && node.cell == self.search.end_cell
                && self.state.visited[flat] != self.search.stamp
            {
                self.publish_batch(self.batch.completed, self.batch.completed);
                break;
            }
            assert_eq!(self.advance(host)?, Status::Advanced);
            self.publish_batch(self.batch.attempts, self.batch.completed + 1);
        }
        Ok(self.batch.completed)
    }
}

fn js_to_i32(value: f64) -> i32 {
    if !value.is_finite() || value == 0.0 {
        return 0;
    }
    let reduced = value.trunc() % 4_294_967_296.0;
    (if reduced < 0.0 {
        reduced + 4_294_967_296.0
    } else {
        reduced
    }) as u32 as i32
}

fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    if a == 0.0 && b == 0.0 {
        return if a.is_sign_negative() || b.is_sign_negative() {
            -0.0
        } else {
            0.0
        };
    }
    if a < b {
        a
    } else {
        b
    }
}

impl SearchState {
    /// Versioned layout-independent materialization payload (ABI-DRAFT.md).
    /// f64 bits remain exact; integer fields are their low 32-bit bit patterns.
    pub fn words(&self) -> Vec<u64> {
        fn integer(v: i32) -> u64 {
            v as u32 as u64
        }
        fn ints(out: &mut Vec<u64>, values: &[i32]) {
            out.push(values.len() as u64);
            out.extend(values.iter().map(|&v| integer(v)));
        }
        fn uints(out: &mut Vec<u64>, values: &[u32]) {
            out.push(values.len() as u64);
            out.extend(values.iter().map(|&v| v as u64));
        }
        fn floats(out: &mut Vec<u64>, values: &[f64]) {
            out.push(values.len() as u64);
            out.extend(values.iter().map(|v| v.to_bits()));
        }
        fn lists(out: &mut Vec<u64>, values: &OrderedLists) {
            out.push(values.order.len() as u64);
            for &key in &values.order {
                out.push(integer(key));
                ints(out, values.entries[key as usize].as_ref().unwrap());
            }
        }
        let mut out = vec![1, self.heap.n as u64, self.heap.entries.len() as u64];
        for v in &self.heap.entries {
            out.push(v.f.to_bits());
            out.push(integer(v.id));
        }
        out.extend([self.pool.n as u64, self.pool.nodes.len() as u64]);
        for v in &self.pool.nodes {
            out.extend([
                integer(v.z),
                integer(v.cell),
                v.g.to_bits(),
                integer(v.parent),
                integer(v.rip_head),
                integer(v.rip_count),
            ]);
        }
        out.extend([self.rips.n as u64, self.rips.entries.len() as u64]);
        for v in &self.rips.entries {
            out.extend([integer(v.owner), integer(v.prev)]);
        }
        uints(&mut out, &self.visited);
        uints(&mut out, &self.visited_flat);
        uints(&mut out, &self.best_stamp);
        floats(&mut out, &self.best_g);
        out.extend([
            self.move_cost.to_bits(),
            integer(self.move_head),
            self.move_rips.to_bits(),
        ]);
        ints(&mut out, &self.via_scratch);
        ints(&mut out, &self.trace_scratch);
        ints(&mut out, &self.layer_scratch);
        lists(&mut out, &self.via_lists);
        lists(&mut out, &self.footprints);
        out.push(self.layer_stamps.len() as u64);
        for (i, &stamp) in self.layer_stamps.iter().enumerate() {
            out.push(stamp as u64);
            if let Some(value) = &self.layer_lists[i] {
                out.push(1);
                ints(&mut out, value);
            } else {
                out.push(0);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests;

mod materialization;

#[cfg(target_arch = "wasm32")]
mod wasm;
