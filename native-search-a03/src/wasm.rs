//! ABI v1 adapter. The caller owns a strict, synchronous non-reentry boundary.
//! There are no RefCell guards or owned temporaries across imported calls: a
//! JavaScript exception unwinds WebAssembly without running Rust destructors.
use super::*;
use core::convert::Infallible;

#[link(wasm_import_module = "a03_host")]
extern "C" {
    #[link_name = "hypot"]
    fn host_hypot(dx: f64, dy: f64) -> f64;
    #[link_name = "footprint"]
    fn host_footprint(cell: i32, destination: u32, capacity: u32) -> u32;
}

struct WasmHost {
    scratch: Vec<i32>,
}
impl Host for WasmHost {
    type Error = Infallible;
    fn hypot(&mut self, dx: f64, dy: f64) -> Result<f64, Infallible> {
        Ok(unsafe { host_hypot(dx, dy) })
    }
    fn footprint(&mut self, cell: i32) -> Result<Vec<i32>, Infallible> {
        // The persistent allocation predates the import. Never allocate or
        // re-enter an export in the callback; it writes only this memory span.
        let length = unsafe {
            host_footprint(
                cell,
                self.scratch.as_mut_ptr() as u32,
                self.scratch.len() as u32,
            )
        } as usize;
        assert!(
            length <= self.scratch.len(),
            "invalid host footprint length"
        );
        Ok(self.scratch[..length].to_vec())
    }
}

static mut KERNEL: Option<Kernel> = None;
static mut PENDING: Option<Problem> = None;
static mut HOST: WasmHost = WasmHost {
    scratch: Vec::new(),
};
static mut DISTANCE_STATS: [u32; 4] = [0; 4];
static mut PUBLISHED: [u32; 8] = [0, 0, u32::MAX, 0, 0, 0, 0, 0];
static mut SNAPSHOT: Vec<u64> = Vec::new();
static mut DISTANCE_SNAPSHOT: Vec<u64> = Vec::new();
static mut MATERIALIZATION: Option<materialization::Materialization> = None;
static mut DISTANCE_VIEWS: Vec<u32> = Vec::new();
static mut GOAL_CELLS: Vec<i32> = Vec::new();
static mut GOAL_RIPS: Vec<i32> = Vec::new();

// References exist only within one export. The JS bridge forbids reentry, and
// imports neither retain pointers nor invoke exports. No borrow guard survives
// an imported exception, so the next publish/materialize export is usable.
unsafe fn kernel() -> Option<&'static mut Kernel> {
    (*core::ptr::addr_of_mut!(KERNEL)).as_mut()
}
unsafe fn problem() -> Option<&'static mut Problem> {
    if let Some(k) = kernel() {
        Some(&mut k.problem)
    } else {
        (*core::ptr::addr_of_mut!(PENDING)).as_mut()
    }
}
unsafe fn publish(slot: usize, value: u32) {
    core::ptr::write_volatile(
        core::ptr::addr_of_mut!(PUBLISHED).cast::<u32>().add(slot),
        value,
    );
}
fn costs(via: f64, rip: f64, trace_rip: f64, via_rip: f64, greedy: f64, cap: f64) -> Costs {
    Costs {
        via,
        rip,
        trace_rip,
        via_rip,
        greedy,
        cap,
    }
}
fn valid_search(problem: &Problem, search: Search) -> bool {
    search.stamp != 0
        && search.active >= 0
        && (search.active as usize) < problem.root_overlap.len()
        && [search.start_z, search.end_z]
            .iter()
            .all(|&v| v >= 0 && (v as usize) < problem.layers)
        && [search.start_cell, search.end_cell]
            .iter()
            .all(|&v| v >= 0 && (v as usize) < problem.plane)
}

#[no_mangle]
pub extern "C" fn a03_abi_version() -> u32 {
    1
}

#[no_mangle]
pub extern "C" fn a03_setup(
    plane: u32,
    layers: u32,
    edges: u32,
    shared: u32,
    connections: u32,
) -> u32 {
    let (p, l, e, n, c) = (
        plane as usize,
        layers as usize,
        edges as usize,
        shared as usize,
        connections as usize,
    );
    let Some(states) = p.checked_mul(l) else {
        return 0;
    };
    if p == 0
        || l == 0
        || states > MAX_STATES
        || e > i32::MAX as usize
        || n > i32::MAX as usize
        || c > i32::MAX as usize
    {
        return 0;
    }
    a03_clear();
    unsafe {
        PENDING = Some(Problem {
            plane: p,
            layers: l,
            x: vec![0.0; p],
            y: vec![0.0; p],
            offsets: vec![0; p + 1],
            neighbors: vec![0; e],
            edge_costs: vec![0.0; e],
            via_allowed: vec![0; p],
            owners: vec![-1; states],
            port_owners: vec![-1; states],
            shared_offsets: vec![0; states + 1],
            shared_ids: vec![0; n],
            penalties: vec![0.0; p],
            root_overlap: vec![0; c],
        });
        (*core::ptr::addr_of_mut!(HOST)).scratch.resize(p, 0);
    }
    1
}

#[no_mangle]
pub extern "C" fn a03_resize_shared(length: u32) {
    assert!(length <= i32::MAX as u32);
    unsafe {
        problem()
            .expect("A03 setup required")
            .shared_ids
            .resize(length as usize, 0);
    }
}

#[no_mangle]
pub extern "C" fn a03_validate_inputs() -> u32 {
    unsafe { problem().is_some_and(|p| p.validate().is_ok()) as u32 }
}

#[no_mangle]
pub extern "C" fn a03_validate_graph() -> u32 {
    unsafe { problem().is_some_and(|p| p.validate_graph().is_ok()) as u32 }
}

#[no_mangle]
pub extern "C" fn a03_begin(
    stamp: u32,
    active: i32,
    start_z: i32,
    start_cell: i32,
    end_z: i32,
    end_cell: i32,
    start_f: f64,
    clear_stamps: u32,
    via: f64,
    rip: f64,
    trace_rip: f64,
    via_rip: f64,
    greedy: f64,
    cap: f64,
) -> u32 {
    let search = Search {
        stamp,
        active,
        start_z,
        start_cell,
        end_z,
        end_cell,
    };
    let costs = costs(via, rip, trace_rip, via_rip, greedy, cap);
    unsafe {
        let Some(p) = problem() else {
            return 0;
        };
        if p.validate().is_err() || !valid_search(p, search) {
            return 0;
        }
        if let Some(k) = kernel() {
            k.begin(search, start_f, clear_stamps != 0)
                .expect("validated search");
            k.costs = costs;
        } else {
            let p = (*core::ptr::addr_of_mut!(PENDING))
                .take()
                .expect("pending setup");
            KERNEL = Some(Kernel::new(p, costs, search, start_f).expect("validated input"));
        }
        kernel().unwrap().distance_cache.enabled = !cfg!(feature = "uncached-distance-oracle");
        publish(0, 0);
        publish(2, u32::MAX);
        (*core::ptr::addr_of_mut!(SNAPSHOT)).clear();
        (*core::ptr::addr_of_mut!(DISTANCE_SNAPSHOT)).clear();
        (*core::ptr::addr_of_mut!(GOAL_CELLS)).clear();
        (*core::ptr::addr_of_mut!(GOAL_RIPS)).clear();
    }
    a03_publish_state();
    1
}

#[no_mangle]
pub extern "C" fn a03_advance(
    via: f64,
    rip: f64,
    trace_rip: f64,
    via_rip: f64,
    greedy: f64,
    cap: f64,
) -> u32 {
    let status = unsafe {
        let k = kernel().expect("active A03 search required");
        k.costs = costs(via, rip, trace_rip, via_rip, greedy, cap);
        k.publish_batch(1, 0);
        publish(0, 0);
        publish(2, u32::MAX);
        let status = k.advance(&mut *core::ptr::addr_of_mut!(HOST)).unwrap();
        k.publish_batch(1, 1);
        match status {
            Status::Advanced => 0,
            Status::Goal(id) => {
                publish(2, id as u32);
                1
            }
            Status::Empty => 2,
        }
    };
    unsafe {
        publish(0, status);
    }
    a03_publish_state();
    status
}

#[no_mangle]
pub extern "C" fn a03_advance_many(
    limit: u32,
    via: f64,
    rip: f64,
    trace_rip: f64,
    via_rip: f64,
    greedy: f64,
    cap: f64,
) -> u32 {
    let completed = unsafe {
        let k = kernel().expect("active A03 search required");
        k.costs = costs(via, rip, trace_rip, via_rip, greedy, cap);
        publish(0, 0);
        publish(2, u32::MAX);
        k.advance_many(&mut *core::ptr::addr_of_mut!(HOST), limit)
            .unwrap()
    };
    a03_publish_state();
    completed
}

#[no_mangle]
pub extern "C" fn a03_publish_state() {
    unsafe {
        if let Some(k) = kernel() {
            publish(1, k.state.heap.n as u32);
            publish(3, k.batch.attempts);
            publish(4, k.batch.completed);
            publish(5, k.state.pool.n as u32);
            publish(6, k.state.rips.n as u32);
            publish(7, k.search.stamp);
            DISTANCE_STATS = [
                k.distance_cache.slots as u32,
                k.distance_cache.tables.len() as u32,
                k.distance_cache.hits,
                k.distance_cache.misses,
            ];
        }
    }
}

#[no_mangle]
pub extern "C" fn a03_advance_guarded(
    via: f64,
    rip: f64,
    trace_rip: f64,
    via_rip: f64,
    greedy: f64,
    cap: f64,
) -> u32 {
    let supported = unsafe {
        let k = kernel().expect("active A03 search required");
        k.costs = costs(via, rip, trace_rip, via_rip, greedy, cap);
        k.next_graph_row_supported()
    };
    if supported {
        return a03_advance(via, rip, trace_rip, via_rip, greedy, cap);
    }
    unsafe {
        kernel().unwrap().publish_batch(0, 0);
        publish(0, 3);
        publish(2, u32::MAX);
    }
    a03_publish_state();
    3
}

#[no_mangle]
pub extern "C" fn a03_advance_many_guarded(
    limit: u32,
    via: f64,
    rip: f64,
    trace_rip: f64,
    via_rip: f64,
    greedy: f64,
    cap: f64,
) -> u32 {
    let (completed, unsupported) = unsafe {
        let k = kernel().expect("active A03 search required");
        k.costs = costs(via, rip, trace_rip, via_rip, greedy, cap);
        publish(0, 0);
        publish(2, u32::MAX);
        k.advance_many_guarded(&mut *core::ptr::addr_of_mut!(HOST), limit)
            .unwrap()
    };
    unsafe {
        publish(0, if unsupported { 3 } else { 0 });
    }
    a03_publish_state();
    completed
}

#[no_mangle]
pub extern "C" fn a03_collect_goal() {
    unsafe {
        let k = kernel().expect("active A03 search required");
        let goal =
            core::ptr::read_volatile(core::ptr::addr_of!(PUBLISHED).cast::<u32>().add(2)) as i32;
        let cells = &mut *core::ptr::addr_of_mut!(GOAL_CELLS);
        let rips = &mut *core::ptr::addr_of_mut!(GOAL_RIPS);
        cells.clear();
        rips.clear();
        if goal < 0 {
            return;
        }
        let mut id = goal;
        while id >= 0 {
            let node = k.state.pool.nodes[id as usize];
            // Reverse cell/z order too, to obtain start-to-end z/cell pairs.
            cells.extend([node.cell, node.z]);
            id = node.parent;
        }
        cells.reverse();
        let mut head = k.state.pool.nodes[goal as usize].rip_head;
        while head >= 0 {
            let rip = k.state.rips.entries[head as usize];
            rips.push(rip.owner);
            head = rip.prev;
        }
    }
}

#[no_mangle]
pub extern "C" fn a03_export_snapshot() {
    unsafe {
        SNAPSHOT = kernel().expect("active A03 search required").state.words();
    }
}

#[no_mangle]
pub extern "C" fn a03_seed_distance(goal: u32, cell: u32, dx: f64, dy: f64, distance: f64) -> u32 {
    let seeded = unsafe {
        let Some(k) = kernel() else {
            return 0;
        };
        k.distance_cache.seed(
            k.problem.plane,
            goal as usize,
            cell as usize,
            dx,
            dy,
            distance,
        )
    };
    if seeded {
        a03_publish_state();
    }
    seeded as u32
}

#[no_mangle]
pub extern "C" fn a03_export_distance_cache() {
    unsafe {
        let k = kernel().expect("active A03 search required");
        DISTANCE_SNAPSHOT = k.distance_cache.words(k.problem.plane);
    }
}

#[no_mangle]
pub extern "C" fn a03_export_materialization() {
    unsafe {
        let k = kernel().expect("active A03 search required");
        (*core::ptr::addr_of_mut!(MATERIALIZATION))
            .get_or_insert_with(materialization::Materialization::default)
            .prepare(&k.state);
    }
}

#[no_mangle]
pub extern "C" fn a03_export_distance_views() {
    unsafe {
        let k = kernel().expect("active A03 search required");
        k.distance_cache.view_words(
            k.problem.plane,
            &mut *core::ptr::addr_of_mut!(DISTANCE_VIEWS),
        );
    }
}

#[no_mangle]
pub extern "C" fn a03_clear() {
    unsafe {
        KERNEL = None;
        PENDING = None;
        HOST = WasmHost {
            scratch: Vec::new(),
        };
        SNAPSHOT = Vec::new();
        DISTANCE_SNAPSHOT = Vec::new();
        MATERIALIZATION = None;
        DISTANCE_VIEWS = Vec::new();
        GOAL_CELLS = Vec::new();
        GOAL_RIPS = Vec::new();
        PUBLISHED = [0, 0, u32::MAX, 0, 0, 0, 0, 0];
        DISTANCE_STATS = [0; 4];
    }
}

unsafe fn span(kind: u32) -> (u32, u32) {
    macro_rules! buffer {
        ($v:expr) => {{
            let v = &$v;
            (v.as_ptr() as u32, v.len() as u32)
        }};
    }
    if kind <= 12 {
        let Some(p) = problem() else {
            return (0, 0);
        };
        return match kind {
            1 => buffer!(p.x),
            2 => buffer!(p.y),
            3 => buffer!(p.offsets),
            4 => buffer!(p.neighbors),
            5 => buffer!(p.edge_costs),
            6 => buffer!(p.via_allowed),
            7 => buffer!(p.owners),
            8 => buffer!(p.port_owners),
            9 => buffer!(p.shared_offsets),
            10 => buffer!(p.shared_ids),
            11 => buffer!(p.penalties),
            12 => buffer!(p.root_overlap),
            _ => (0, 0),
        };
    }
    match kind {
        20..=23 => {
            let Some(k) = kernel() else {
                return (0, 0);
            };
            match kind {
                20 => buffer!(k.state.visited),
                21 => buffer!(k.state.visited_flat),
                22 => buffer!(k.state.best_stamp),
                _ => buffer!(k.state.best_g),
            }
        }
        30 => (core::ptr::addr_of!(PUBLISHED) as u32, 8),
        31 => buffer!(*core::ptr::addr_of!(GOAL_CELLS)),
        32 => buffer!(*core::ptr::addr_of!(GOAL_RIPS)),
        33 => (core::ptr::addr_of!(DISTANCE_STATS) as u32, 4),
        40 => buffer!(*core::ptr::addr_of!(SNAPSHOT)),
        41 => buffer!(*core::ptr::addr_of!(DISTANCE_SNAPSHOT)),
        42 => match (*core::ptr::addr_of!(MATERIALIZATION)).as_ref() {
            Some(value) => buffer!(value.metadata),
            None => (0, 0),
        },
        43 => buffer!(*core::ptr::addr_of!(DISTANCE_VIEWS)),
        _ => (0, 0),
    }
}
#[no_mangle]
pub extern "C" fn a03_pointer(kind: u32) -> u32 {
    unsafe { span(kind).0 }
}
#[no_mangle]
pub extern "C" fn a03_length(kind: u32) -> u32 {
    unsafe { span(kind).1 }
}
