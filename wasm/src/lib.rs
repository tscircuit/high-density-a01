use std::cmp::Ordering;
use std::collections::{HashMap, VecDeque};
use std::rc::Rc;

use indexmap::IndexMap;
use ordered_float::NotNan;
use serde::{Deserialize, Serialize};
use smallvec::SmallVec;
use wasm_bindgen::prelude::*;

#[cfg(feature = "console_error_panic_hook")]
fn set_panic_hook() {
    console_error_panic_hook::set_once();
}
#[cfg(not(feature = "console_error_panic_hook"))]
fn set_panic_hook() {}

// -----------------------------
// Public (JS-facing) Types
// -----------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighDensitySolverA01Props {
    pub node_with_port_points: NodeWithPortPoints,
    pub cell_size_mm: f64,
    pub via_diameter: f64,

    #[serde(default)]
    pub trace_thickness: Option<f64>,
    #[serde(default)]
    pub trace_margin: Option<f64>,
    #[serde(default)]
    pub via_min_dist_from_border: Option<f64>,

    #[serde(default)]
    pub show_penalty_map: Option<bool>,
    #[serde(default)]
    pub show_used_cell_map: Option<bool>,

    #[serde(default)]
    pub hyper_parameters: Option<HyperParametersPartial>,

    /// WASM-friendly replacement for TS `initialPenaltyFn`.
    /// Provide a [row][col] matrix matching rows/cols derived from width/height/cellSizeMm.
    #[serde(default)]
    pub penalty_map: Option<Vec<Vec<f64>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeWithPortPoints {
    pub width: f64,
    pub height: f64,
    pub center: Point2,
    pub port_points: Vec<PortPoint>,
    #[serde(default)]
    pub available_z: Option<Vec<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortPoint {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub connection_name: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point2 {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HyperParametersPartial {
    #[serde(default)]
    pub shuffle_seed: Option<u32>,
    #[serde(default)]
    pub rip_cost: Option<f32>,
    #[serde(default)]
    pub rip_trace_penalty: Option<f32>,
    #[serde(default)]
    pub rip_via_penalty: Option<f32>,
    #[serde(default)]
    pub via_base_cost: Option<f32>,
    #[serde(default)]
    pub greedy_multiplier: Option<f32>,
}

#[derive(Debug, Clone, Copy)]
struct HyperParameters {
    shuffle_seed: u32,
    rip_cost: f32,
    rip_trace_penalty: f32,
    rip_via_penalty: f32,
    via_base_cost: f32,
    greedy_multiplier: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighDensityIntraNodeRoute {
    pub connection_name: String,
    pub trace_thickness: f64,
    pub via_diameter: f64,
    pub route: Vec<RoutePoint>,
    pub vias: Vec<Point2>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutePoint {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolverState {
    pub solved: bool,
    pub failed: bool,
    pub error: Option<String>,
    pub active_connection_name: Option<String>,
    pub remaining_connections: usize,
    pub solved_routes: usize,
    pub rows: u32,
    pub cols: u32,
    pub layers: u32,
}

// -----------------------------
// Internal solver structures
// -----------------------------

type ConnId = u32;

#[derive(Debug, Clone, Copy)]
struct CellCoord {
    z: u32, // layer index
    row: u32,
    col: u32,
}

#[derive(Debug, Clone)]
struct ConnectionSeg {
    conn: ConnId,
    start: CellCoord,
    end: CellCoord,
    start_idx: u32,
    end_idx: u32,
}

#[derive(Debug, Clone)]
struct SolvedRouteInternal {
    route_cells: Vec<CellCoord>,
    via_cells: Vec<(u32, u32)>, // (row, col)
}

#[derive(Debug, Clone)]
struct SearchNode {
    cell: CellCoord,
    cell_idx: u32,
    g: f32,
    #[allow(dead_code)]
    f: f32,
    parent: Option<u32>,
    ripped: Option<Rc<RippedNode>>,
}

#[derive(Debug)]
struct RippedNode {
    id: ConnId,
    prev: Option<Rc<RippedNode>>,
}

#[derive(Debug, Clone)]
struct HeapEntry {
    f: NotNan<f32>,
    seq: u32,
    node_id: u32,
}

impl Eq for HeapEntry {}
impl PartialEq for HeapEntry {
    fn eq(&self, other: &Self) -> bool {
        self.f == other.f && self.seq == other.seq && self.node_id == other.node_id
    }
}
impl Ord for HeapEntry {
    fn cmp(&self, other: &Self) -> Ordering {
        // Min-heap behavior on a max-heap BinaryHeap by reversing comparisons.
        other.f.cmp(&self.f).then_with(|| other.seq.cmp(&self.seq))
    }
}
impl PartialOrd for HeapEntry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

// -----------------------------
// WASM exports
// -----------------------------

#[wasm_bindgen]
pub struct HighDensitySolverA01Wasm {
    solver: Solver,
}

#[wasm_bindgen]
impl HighDensitySolverA01Wasm {
    #[wasm_bindgen(constructor)]
    pub fn new(props: JsValue) -> Result<HighDensitySolverA01Wasm, JsValue> {
        set_panic_hook();
        let props: HighDensitySolverA01Props = serde_wasm_bindgen::from_value(props)?;
        Ok(Self {
            solver: Solver::new(props),
        })
    }

    /// Equivalent to TS `_setup()`.
    pub fn setup(&mut self) {
        self.solver.setup();
    }

    /// Equivalent to TS `_step()`.
    pub fn step(&mut self) {
        self.solver.step();
    }

    /// Run until solved/failed, or until `max_steps` (if provided).
    pub fn run(&mut self, max_steps: Option<u32>) {
        self.solver.run(max_steps);
    }

    pub fn is_solved(&self) -> bool {
        self.solver.solved
    }

    pub fn is_failed(&self) -> bool {
        self.solver.failed
    }

    pub fn error(&self) -> Option<String> {
        self.solver.error.clone()
    }

    pub fn get_state(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.solver.get_state()).map_err(Into::into)
    }

    pub fn get_output(&self) -> Result<JsValue, JsValue> {
        let out = self.solver.get_output();
        serde_wasm_bindgen::to_value(&out).map_err(Into::into)
    }
}

/// Convenience helper: run the entire solve in one call.
#[wasm_bindgen]
pub fn solve_high_density_a01(props: JsValue) -> Result<JsValue, JsValue> {
    set_panic_hook();
    let props: HighDensitySolverA01Props = serde_wasm_bindgen::from_value(props)?;
    let mut solver = Solver::new(props);
    solver.setup();
    solver.run(None);
    serde_wasm_bindgen::to_value(&solver.get_output()).map_err(Into::into)
}

// -----------------------------
// Solver implementation
// -----------------------------

struct Solver {
    // Inputs
    node: NodeWithPortPoints,
    cell_size_mm: f64,
    cell_size_cost: f32,
    via_diameter: f64,
    trace_thickness: f64,
    trace_margin: f64,
    via_min_dist_from_border: f64,
    #[allow(dead_code)]
    show_penalty_map: bool,
    #[allow(dead_code)]
    show_used_cell_map: bool,
    hyper: HyperParameters,

    // Grid
    rows: u32,
    cols: u32,
    layers: u32,
    origin: Point2,

    // Z mapping
    available_z: Vec<f64>,
    layer_to_z: Vec<f64>,

    // Maps
    penalty_map: Vec<f32>, // rows*cols
    used_cells: Vec<i32>,  // layers*rows*cols, occupant conn id or -1

    // Connection name interning
    conn_names: Vec<String>,                  // id -> name
    conn_name_to_id: HashMap<String, ConnId>, // name -> id
    used_indices_by_conn: Vec<Vec<u32>>,      // id -> list of used cell indices

    // Connection queues and solved routes
    unsolved: VecDeque<ConnectionSeg>,
    solved_routes: HashMap<ConnId, SolvedRouteInternal>,

    // A* state
    active: Option<ConnectionSeg>,
    open: std::collections::BinaryHeap<HeapEntry>,
    nodes: Vec<SearchNode>,
    visited_stamp: Vec<u32>,
    stamp: u32,
    seq: u32,

    // Precomputed geometry
    via_offsets: Vec<(i32, i32)>,
    margin_cells: i32,

    // Status
    solved: bool,
    failed: bool,
    error: Option<String>,

    // Setup-only: optional precomputed penalty
    initial_penalty_map: Option<Vec<Vec<f64>>>,
}

impl Solver {
    fn new(props: HighDensitySolverA01Props) -> Self {
        let trace_thickness = props.trace_thickness.unwrap_or(0.1);
        let trace_margin = props.trace_margin.unwrap_or(0.15);
        let via_min_dist_from_border = props.via_min_dist_from_border.unwrap_or(1.0);

        let hyper_partial = props.hyper_parameters.unwrap_or(HyperParametersPartial {
            shuffle_seed: None,
            rip_cost: None,
            rip_trace_penalty: None,
            rip_via_penalty: None,
            via_base_cost: None,
            greedy_multiplier: None,
        });

        let hyper = HyperParameters {
            shuffle_seed: hyper_partial.shuffle_seed.unwrap_or(0),
            rip_cost: hyper_partial.rip_cost.unwrap_or(10.0),
            rip_trace_penalty: hyper_partial.rip_trace_penalty.unwrap_or(0.5),
            rip_via_penalty: hyper_partial.rip_via_penalty.unwrap_or(0.75),
            via_base_cost: hyper_partial.via_base_cost.unwrap_or(0.1),
            greedy_multiplier: hyper_partial.greedy_multiplier.unwrap_or(1.1),
        };

        Self {
            node: props.node_with_port_points,
            cell_size_mm: props.cell_size_mm,
            cell_size_cost: props.cell_size_mm as f32,
            via_diameter: props.via_diameter,
            trace_thickness,
            trace_margin,
            via_min_dist_from_border,
            show_penalty_map: props.show_penalty_map.unwrap_or(false),
            show_used_cell_map: props.show_used_cell_map.unwrap_or(false),
            hyper,

            rows: 0,
            cols: 0,
            layers: 0,
            origin: Point2 { x: 0.0, y: 0.0 },

            available_z: Vec::new(),
            layer_to_z: Vec::new(),

            penalty_map: Vec::new(),
            used_cells: Vec::new(),

            conn_names: Vec::new(),
            conn_name_to_id: HashMap::new(),
            used_indices_by_conn: Vec::new(),

            unsolved: VecDeque::new(),
            solved_routes: HashMap::new(),

            active: None,
            open: std::collections::BinaryHeap::new(),
            nodes: Vec::new(),
            visited_stamp: Vec::new(),
            stamp: 1,
            seq: 0,

            via_offsets: Vec::new(),
            margin_cells: 0,

            solved: false,
            failed: false,
            error: None,

            initial_penalty_map: props.penalty_map,
        }
    }

    fn setup(&mut self) {
        self.solved = false;
        self.failed = false;
        self.error = None;
        self.active = None;
        self.open.clear();
        self.nodes.clear();
        self.seq = 0;

        // Match TS semantics:
        // - If `availableZ` is provided, use it as-is (do not reorder).
        // - Otherwise derive from port points and sort ascending.
        self.available_z = if let Some(zs) = &self.node.available_z {
            zs.clone()
        } else {
            let mut zs: Vec<f64> = self.node.port_points.iter().map(|pp| pp.z).collect();
            zs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
            zs.dedup();
            zs
        };
        if self.available_z.is_empty() {
            self.available_z.push(0.0);
        }
        self.layer_to_z = self.available_z.clone();
        self.layers = self.layer_to_z.len() as u32;

        // Grid dimensions
        let width = self.node.width;
        let height = self.node.height;
        let center = self.node.center;

        self.rows = ((height / self.cell_size_mm).floor() as i64).max(1) as u32;
        self.cols = ((width / self.cell_size_mm).floor() as i64).max(1) as u32;

        self.origin = Point2 {
            x: center.x - width / 2.0,
            y: center.y - height / 2.0,
        };

        // Precompute geometry
        let via_radius_cells = ((self.via_diameter / 2.0) / self.cell_size_mm).ceil() as i32;
        self.via_offsets = circle_offsets(via_radius_cells);
        self.margin_cells = (self.trace_margin / self.cell_size_mm).ceil() as i32;

        // Allocate maps
        let penalty_len = (self.rows as usize) * (self.cols as usize);
        self.penalty_map = vec![0.0; penalty_len];

        // Apply optional penalty map override
        if let Some(pm) = &self.initial_penalty_map {
            let rmax = pm.len().min(self.rows as usize);
            for r in 0..rmax {
                let row = &pm[r];
                let cmax = row.len().min(self.cols as usize);
                for c in 0..cmax {
                    let idx = r * (self.cols as usize) + c;
                    self.penalty_map[idx] = row[c] as f32;
                }
            }
        }

        let used_len = (self.layers as usize) * (self.rows as usize) * (self.cols as usize);
        self.used_cells = vec![-1; used_len];

        // Visited stamp array (avoids clearing per connection)
        self.visited_stamp = vec![0; used_len];
        self.stamp = 1;

        // Build connections and intern names
        let conns = self.build_connections_from_port_points();
        self.unsolved = VecDeque::from(conns);
        self.solved_routes.clear();

        // Used index lists per connection
        self.used_indices_by_conn = vec![Vec::new(); self.conn_names.len()];

        // Shuffle
        self.shuffle_connections();

        self.active = None;
    }

    fn get_state(&self) -> SolverState {
        SolverState {
            solved: self.solved,
            failed: self.failed,
            error: self.error.clone(),
            active_connection_name: self
                .active
                .as_ref()
                .map(|c| self.conn_names[c.conn as usize].clone()),
            remaining_connections: self.unsolved.len(),
            solved_routes: self.solved_routes.len(),
            rows: self.rows,
            cols: self.cols,
            layers: self.layers,
        }
    }

    fn run(&mut self, max_steps: Option<u32>) {
        if self.solved || self.failed {
            return;
        }
        match max_steps {
            Some(n) => {
                for _ in 0..n {
                    if self.solved || self.failed {
                        break;
                    }
                    self.step();
                }
            }
            None => {
                while !self.solved && !self.failed {
                    self.step();
                }
            }
        }
    }

    fn step(&mut self) {
        if self.solved || self.failed {
            return;
        }

        // 1) If no active connection, dequeue next
        if self.active.is_none() {
            if let Some(next) = self.unsolved.pop_front() {
                self.start_connection(next);
                return;
            }
            self.solved = true;
            return;
        }

        // 2) If open set empty => fail
        if self.open.is_empty() {
            let name = self
                .active
                .as_ref()
                .map(|c| self.conn_names[c.conn as usize].clone())
                .unwrap_or_else(|| "<unknown>".to_string());
            self.error = Some(format!("No path found for {name}"));
            self.failed = true;
            return;
        }

        // 3) Pop best candidate
        let current_node_id = loop {
            let entry = match self.open.pop() {
                Some(e) => e,
                None => {
                    let name = self
                        .active
                        .as_ref()
                        .map(|c| self.conn_names[c.conn as usize].clone())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    self.error = Some(format!("No path found for {name}"));
                    self.failed = true;
                    return;
                }
            };
            let nid = entry.node_id as usize;
            if nid >= self.nodes.len() {
                continue;
            }
            let idx = self.nodes[nid].cell_idx as usize;
            if self.visited_stamp[idx] == self.stamp {
                continue;
            }
            break entry.node_id;
        };

        let active = self.active.as_ref().unwrap().clone();
        let current = self.nodes[current_node_id as usize].clone();

        // Mark visited
        self.visited_stamp[current.cell_idx as usize] = self.stamp;

        // 4) End condition
        if current.cell_idx == active.end_idx {
            self.finalize_route(current_node_id);
            self.active = None;
            return;
        }

        // 5) Expand neighbors (8 dirs + via)
        let CellCoord { z, row, col } = current.cell;

        const DIRS: [(i32, i32); 8] = [
            (-1, -1),
            (-1, 0),
            (-1, 1),
            (0, -1),
            (0, 1),
            (1, -1),
            (1, 0),
            (1, 1),
        ];

        // Lateral
        for (dr, dc) in DIRS.iter() {
            let nr = row as i32 + dr;
            let nc = col as i32 + dc;
            if nr < 0 || nc < 0 || nr >= self.rows as i32 || nc >= self.cols as i32 {
                continue;
            }
            let neighbor = CellCoord {
                z,
                row: nr as u32,
                col: nc as u32,
            };
            self.try_push_neighbor(&active, current_node_id, &current, neighbor);
        }

        // Via
        let allow_vias = if self.via_min_dist_from_border > 0.0 {
            let dist_to_edge = {
                let left = (col as f64) * self.cell_size_mm;
                let right = ((self.cols - 1 - col) as f64) * self.cell_size_mm;
                let bottom = (row as f64) * self.cell_size_mm;
                let top = ((self.rows - 1 - row) as f64) * self.cell_size_mm;
                left.min(right).min(bottom).min(top)
            };
            dist_to_edge >= self.via_min_dist_from_border
        } else {
            true
        };

        if allow_vias {
            for nz in 0..self.layers {
                if nz == z {
                    continue;
                }
                let neighbor = CellCoord { z: nz, row, col };
                self.try_push_neighbor(&active, current_node_id, &current, neighbor);
            }
        }
    }

    fn start_connection(&mut self, conn: ConnectionSeg) {
        self.active = Some(conn.clone());
        self.open.clear();
        self.nodes.clear();
        self.seq = 0;

        // Stamp increment (avoid clearing visited array)
        self.stamp = self.stamp.wrapping_add(1);
        if self.stamp == 0 {
            self.visited_stamp.fill(0);
            self.stamp = 1;
        }

        let h = self.compute_h(conn.start, conn.end);
        let f_val = h * self.hyper.greedy_multiplier;
        let f = NotNan::new(f_val).unwrap_or_else(|_| NotNan::new(0.0).unwrap());

        self.nodes.push(SearchNode {
            cell: conn.start,
            cell_idx: conn.start_idx,
            g: 0.0,
            f: f_val,
            parent: None,
            ripped: None,
        });

        let seq = self.next_seq();
        self.open.push(HeapEntry { f, seq, node_id: 0 });
    }

    fn try_push_neighbor(
        &mut self,
        active: &ConnectionSeg,
        current_node_id: u32,
        current: &SearchNode,
        neighbor: CellCoord,
    ) {
        let neighbor_idx = self.cell_index(neighbor.z, neighbor.row, neighbor.col);
        if self.visited_stamp[neighbor_idx as usize] == self.stamp {
            return;
        }

        let (move_cost, new_ripped) = self.compute_move_cost_and_rips(active, current, neighbor);
        let g = current.g + move_cost;
        let h = self.compute_h(neighbor, active.end);
        let f_val = g + h * self.hyper.greedy_multiplier;

        let f = match NotNan::new(f_val) {
            Ok(v) => v,
            Err(_) => return,
        };

        let node_id = self.nodes.len() as u32;
        self.nodes.push(SearchNode {
            cell: neighbor,
            cell_idx: neighbor_idx,
            g,
            f: f_val,
            parent: Some(current_node_id),
            ripped: new_ripped,
        });

        let seq = self.next_seq();
        self.open.push(HeapEntry { f, seq, node_id });
    }

    fn compute_h(&self, a: CellCoord, b: CellCoord) -> f32 {
        let dr = if a.row > b.row {
            a.row - b.row
        } else {
            b.row - a.row
        };
        let dc = if a.col > b.col {
            a.col - b.col
        } else {
            b.col - a.col
        };
        (dr + dc) as f32 * self.cell_size_cost
    }

    fn compute_move_cost_and_rips(
        &self,
        active: &ConnectionSeg,
        current: &SearchNode,
        to: CellCoord,
    ) -> (f32, Option<Rc<RippedNode>>) {
        let from = current.cell;
        let mut cost: f32 = 0.0;
        let mut ripped = current.ripped.clone();

        if from.z != to.z {
            cost += self.hyper.via_base_cost;
            cost += self.penalty_at(to.row, to.col);

            let occs = self.via_footprint_unique_occupants(to.row, to.col, active.conn);
            for occ in occs {
                if !ripped_contains(&ripped, occ) {
                    cost += self.hyper.rip_cost;
                    ripped = Some(Rc::new(RippedNode {
                        id: occ,
                        prev: ripped.clone(),
                    }));
                }
                cost += self.hyper.rip_via_penalty;
            }
        } else {
            let dr = if from.row > to.row {
                from.row - to.row
            } else {
                to.row - from.row
            };
            let dc = if from.col > to.col {
                from.col - to.col
            } else {
                to.col - from.col
            };

            let step = if dr + dc > 1 { 1.41421356 } else { 1.0 };
            cost += step * self.cell_size_cost;

            cost += self.penalty_at(to.row, to.col);

            let idx = self.cell_index(to.z, to.row, to.col) as usize;
            let occ = self.used_cells[idx];
            if occ >= 0 {
                let occ = occ as u32;
                if occ != active.conn {
                    if !ripped_contains(&ripped, occ) {
                        cost += self.hyper.rip_cost;
                        ripped = Some(Rc::new(RippedNode {
                            id: occ,
                            prev: ripped.clone(),
                        }));
                    }
                    cost += self.hyper.rip_trace_penalty;
                }
            }
        }

        (cost, ripped)
    }

    fn penalty_at(&self, row: u32, col: u32) -> f32 {
        let idx = (row as usize) * (self.cols as usize) + (col as usize);
        self.penalty_map.get(idx).copied().unwrap_or(0.0)
    }

    fn via_footprint_unique_occupants(
        &self,
        row: u32,
        col: u32,
        active_conn: ConnId,
    ) -> SmallVec<[ConnId; 8]> {
        let mut occs: SmallVec<[ConnId; 8]> = SmallVec::new();

        let r0 = row as i32;
        let c0 = col as i32;

        for z in 0..self.layers {
            for (dr, dc) in self.via_offsets.iter() {
                let r = r0 + dr;
                let c = c0 + dc;
                if r < 0 || c < 0 || r >= self.rows as i32 || c >= self.cols as i32 {
                    continue;
                }
                let idx = self.cell_index(z, r as u32, c as u32) as usize;
                let occ = self.used_cells[idx];
                if occ < 0 {
                    continue;
                }
                let occ = occ as u32;
                if occ == active_conn {
                    continue;
                }
                if !occs.contains(&occ) {
                    occs.push(occ);
                }
            }
        }

        occs
    }

    fn finalize_route(&mut self, candidate_node_id: u32) {
        let active = match self.active.as_ref() {
            Some(a) => a.clone(),
            None => return,
        };
        let conn_id = active.conn;

        // Reconstruct path
        let mut route_cells: Vec<CellCoord> = Vec::new();
        let mut node_id_opt = Some(candidate_node_id);
        while let Some(nid) = node_id_opt {
            let n = &self.nodes[nid as usize];
            route_cells.push(n.cell);
            node_id_opt = n.parent;
        }
        route_cells.reverse();

        // Detect vias
        let mut via_cells: Vec<(u32, u32)> = Vec::new();
        for i in 1..route_cells.len() {
            let prev = route_cells[i - 1];
            let curr = route_cells[i];
            if curr.z != prev.z {
                via_cells.push((curr.row, curr.col));
            }
        }

        // 1) Rip any traces displaced along the candidate path
        let ripped = self.nodes[candidate_node_id as usize].ripped.clone();
        if let Some(r) = ripped {
            let mut cur = Some(r);
            while let Some(node_rc) = cur {
                let id = node_rc.id;
                if id != conn_id {
                    self.rip_trace(id);
                }
                cur = node_rc.prev.clone();
            }
        }

        // 2) Mark route cells as used (including margin)
        // Match TS: only claim free cells or our own cells for margins —
        // never overwrite another trace's cells.
        let m = self.margin_cells;
        for cell in route_cells.iter() {
            let z = cell.z;
            let cr = cell.row as i32;
            let cc = cell.col as i32;
            for dr in -m..=m {
                for dc in -m..=m {
                    let r = cr + dr;
                    let c = cc + dc;
                    if r < 0 || c < 0 || r >= self.rows as i32 || c >= self.cols as i32 {
                        continue;
                    }
                    let idx = self.cell_index(z, r as u32, c as u32);
                    let existing = self.used_cells[idx as usize];
                    if existing >= 0 && existing as u32 != conn_id {
                        continue;
                    }
                    self.set_used_cell(conn_id, idx);
                }
            }
        }

        // 3) Mark via footprints across all layers + track displaced occupants
        // Clone via_offsets to avoid borrow conflict with set_used_cell
        let via_offsets = self.via_offsets.clone();
        let mut displaced: SmallVec<[ConnId; 8]> = SmallVec::new();
        for (vr, vc) in via_cells.iter().copied() {
            let r0 = vr as i32;
            let c0 = vc as i32;
            for z in 0..self.layers {
                for (dr, dc) in via_offsets.iter() {
                    let r = r0 + dr;
                    let c = c0 + dc;
                    if r < 0 || c < 0 || r >= self.rows as i32 || c >= self.cols as i32 {
                        continue;
                    }
                    let idx = self.cell_index(z, r as u32, c as u32);
                    let existing = self.used_cells[idx as usize];
                    if existing >= 0 {
                        let ex = existing as u32;
                        if ex != conn_id && !displaced.contains(&ex) {
                            displaced.push(ex);
                        }
                    }
                    self.set_used_cell(conn_id, idx);
                }
            }
        }

        for d in displaced {
            self.rip_trace(d);
        }

        self.solved_routes.insert(
            conn_id,
            SolvedRouteInternal {
                route_cells,
                via_cells,
            },
        );
    }

    fn set_used_cell(&mut self, conn_id: ConnId, idx: u32) {
        self.used_cells[idx as usize] = conn_id as i32;
        if (conn_id as usize) < self.used_indices_by_conn.len() {
            self.used_indices_by_conn[conn_id as usize].push(idx);
        }
    }

    fn rip_trace(&mut self, conn_id: ConnId) {
        let route = match self.solved_routes.remove(&conn_id) {
            Some(r) => r,
            None => return,
        };

        // Add rip penalties
        for cell in route.route_cells.iter() {
            let idx2d = (cell.row as usize) * (self.cols as usize) + (cell.col as usize);
            if let Some(p) = self.penalty_map.get_mut(idx2d) {
                *p += self.hyper.rip_trace_penalty;
            }
        }
        for (vr, vc) in route.via_cells.iter() {
            let idx2d = (*vr as usize) * (self.cols as usize) + (*vc as usize);
            if let Some(p) = self.penalty_map.get_mut(idx2d) {
                *p += self.hyper.rip_via_penalty;
            }
        }

        // Clear used cells quickly (only those ever marked by this conn)
        if (conn_id as usize) < self.used_indices_by_conn.len() {
            let mut idxs = Vec::new();
            std::mem::swap(&mut idxs, &mut self.used_indices_by_conn[conn_id as usize]);
            for idx in idxs {
                if self.used_cells[idx as usize] == conn_id as i32 {
                    self.used_cells[idx as usize] = -1;
                }
            }
        } else {
            for slot in self.used_cells.iter_mut() {
                if *slot == conn_id as i32 {
                    *slot = -1;
                }
            }
        }

        // Requeue
        if let (Some(start), Some(end)) = (route.route_cells.first(), route.route_cells.last()) {
            self.unsolved.push_back(ConnectionSeg {
                conn: conn_id,
                start: *start,
                end: *end,
                start_idx: self.cell_index(start.z, start.row, start.col),
                end_idx: self.cell_index(end.z, end.row, end.col),
            });
        }
    }

    fn get_output(&self) -> Vec<HighDensityIntraNodeRoute> {
        let mut out = Vec::with_capacity(self.solved_routes.len());
        for (conn_id, route) in self.solved_routes.iter() {
            let name = self
                .conn_names
                .get(*conn_id as usize)
                .cloned()
                .unwrap_or_else(|| format!("conn_{conn_id}"));

            let mut points = Vec::with_capacity(route.route_cells.len());
            for cell in route.route_cells.iter() {
                let x = self.origin.x + (cell.col as f64 + 0.5) * self.cell_size_mm;
                let y = self.origin.y + (cell.row as f64 + 0.5) * self.cell_size_mm;
                let z = self
                    .layer_to_z
                    .get(cell.z as usize)
                    .copied()
                    .unwrap_or(cell.z as f64);
                points.push(RoutePoint { x, y, z });
            }

            let mut vias = Vec::with_capacity(route.via_cells.len());
            for (r, c) in route.via_cells.iter() {
                let x = self.origin.x + (*c as f64 + 0.5) * self.cell_size_mm;
                let y = self.origin.y + (*r as f64 + 0.5) * self.cell_size_mm;
                vias.push(Point2 { x, y });
            }

            out.push(HighDensityIntraNodeRoute {
                connection_name: name,
                trace_thickness: self.trace_thickness,
                via_diameter: self.via_diameter,
                route: points,
                vias,
            });
        }
        out
    }

    fn build_connections_from_port_points(&mut self) -> Vec<ConnectionSeg> {
        // Preserve TS Map insertion semantics
        let mut by_name: IndexMap<String, Vec<PortPoint>> = IndexMap::new();
        for pp in self.node.port_points.iter() {
            by_name
                .entry(pp.connection_name.clone())
                .or_default()
                .push(pp.clone());
        }

        // Build name->id
        self.conn_names.clear();
        self.conn_name_to_id.clear();
        for name in by_name.keys() {
            let id = self.conn_names.len() as u32;
            self.conn_names.push(name.clone());
            self.conn_name_to_id.insert(name.clone(), id);
        }

        let mut conns = Vec::new();
        for (name, pts) in by_name.iter() {
            if pts.len() < 2 {
                continue;
            }
            let conn_id = *self.conn_name_to_id.get(name).unwrap();
            for i in 0..(pts.len() - 1) {
                let start = self.point_to_cell(&pts[i]);
                let end = self.point_to_cell(&pts[i + 1]);
                conns.push(ConnectionSeg {
                    conn: conn_id,
                    start,
                    end,
                    start_idx: self.cell_index(start.z, start.row, start.col),
                    end_idx: self.cell_index(end.z, end.row, end.col),
                });
            }
        }

        conns
    }

    fn point_to_cell(&self, pt: &PortPoint) -> CellCoord {
        let col_f = (pt.x - self.origin.x) / self.cell_size_mm - 0.5;
        let row_f = (pt.y - self.origin.y) / self.cell_size_mm - 0.5;

        // Match JS Math.round semantics: Math.round(x) == floor(x + 0.5)
        let col_i = js_round(col_f);
        let row_i = js_round(row_f);

        let col = col_i.clamp(0, self.cols as i32 - 1) as u32;
        let row = row_i.clamp(0, self.rows as i32 - 1) as u32;

        let z = self
            .available_z
            .iter()
            .position(|&zz| zz == pt.z)
            .unwrap_or(0) as u32;

        CellCoord { z, row, col }
    }

    fn shuffle_connections(&mut self) {
        let seed = self.hyper.shuffle_seed;
        let mut vec: Vec<ConnectionSeg> = self.unsolved.drain(..).collect();

        let mut s = seed;
        let mut rng = || {
            s = s.wrapping_mul(1664525).wrapping_add(1013904223);
            (s as f64) / (u32::MAX as f64)
        };

        for i in (1..vec.len()).rev() {
            let j = (rng() * ((i + 1) as f64)).floor() as usize;
            vec.swap(i, j);
        }

        self.unsolved = VecDeque::from(vec);
    }

    #[inline]
    fn cell_index(&self, z: u32, row: u32, col: u32) -> u32 {
        ((z * self.rows + row) * self.cols + col) as u32
    }

    #[inline]
    fn next_seq(&mut self) -> u32 {
        let s = self.seq;
        self.seq = self.seq.wrapping_add(1);
        s
    }
}

fn js_round(x: f64) -> i32 {
    (x + 0.5).floor() as i32
}

fn circle_offsets(radius: i32) -> Vec<(i32, i32)> {
    if radius <= 0 {
        return vec![(0, 0)];
    }
    let r2 = radius * radius;
    let mut out = Vec::new();
    for dr in -radius..=radius {
        for dc in -radius..=radius {
            if dr * dr + dc * dc <= r2 {
                out.push((dr, dc));
            }
        }
    }
    out
}

fn ripped_contains(ripped: &Option<Rc<RippedNode>>, id: ConnId) -> bool {
    let mut cur = ripped.clone();
    while let Some(node) = cur {
        if node.id == id {
            return true;
        }
        cur = node.prev.clone();
    }
    false
}
