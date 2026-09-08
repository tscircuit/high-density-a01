// Frozen C37 f64 pool and search oracle; no production exports.
struct ReferenceSearchNode {
    cell: f64,
    g: f64,
    parent: i32,
    ripped: i32,
}

#[derive(Default)]
struct ReferencePool {
    nodes: Vec<ReferenceSearchNode>,
}
impl ReferencePool {
    fn clear(&mut self) {
        self.nodes.clear();
    }
    fn push(&mut self, cell: usize, g: f64, parent: i32, ripped: i32) -> u32 {
        let id = self.nodes.len() as u32;
        self.nodes.push(ReferenceSearchNode {
            cell: cell as f64,
            g,
            parent,
            ripped,
        });
        id
    }
}
struct ReferenceKernel {
    rows: usize,
    cols: usize,
    layers: usize,
    plane: usize,
    used: Vec<i32>,
    ports: Vec<i32>,
    diagonals: Vec<i32>,
    penalty: Vec<f64>,
    roots: Vec<u8>,
    offset_dr: Vec<i32>,
    offset_dc: Vec<i32>,
    offset_flat: Vec<i32>,
    scan_radius: i32,
    // Config: start z/r/c, end z/r/c, active ID, min/max via row/col.
    config: Vec<f64>,
    cell_size: f64,
    via_base: f64,
    rip_cost: f64,
    rip_trace: f64,
    rip_via: f64,
    greedy: f64,
    penalty_cap: f64,
    stamp: u32,
    visited: Vec<u32>,
    h_stamp: Vec<u32>,
    h_value: Vec<f64>,
    via_stamp: Vec<u32>,
    via_cache: Vec<Vec<i32>>,
    via_scratch: Vec<i32>,
    heap: Heap,
    pool: ReferencePool,
    rips: Vec<Rip>,
    goal: i32,
    result_cells: Vec<f64>,
    result_rips: Vec<i32>,
    state: Vec<u32>,
}
impl ReferenceKernel {
    fn new(rows: usize, cols: usize, layers: usize, offsets: usize, owners: usize) -> Self {
        let plane = rows * cols;
        let cells = plane * layers;
        let diagonals = layers * rows.saturating_sub(1) * cols.saturating_sub(1) * 2;
        Self {
            rows,
            cols,
            layers,
            plane,
            used: vec![-1; cells],
            ports: vec![-1; cells],
            diagonals: vec![-1; diagonals],
            penalty: vec![0.0; plane],
            roots: vec![0; owners],
            offset_dr: vec![0; offsets],
            offset_dc: vec![0; offsets],
            offset_flat: vec![0; offsets],
            scan_radius: 0,
            config: vec![0.0; 11],
            cell_size: 0.0,
            via_base: 0.0,
            rip_cost: 0.0,
            rip_trace: 0.0,
            rip_via: 0.0,
            greedy: 0.0,
            penalty_cap: 0.0,
            stamp: 0,
            visited: vec![0; cells],
            h_stamp: vec![0; cells],
            h_value: vec![0.0; cells],
            via_stamp: if layers > 2 {
                vec![0; plane]
            } else {
                Vec::new()
            },
            via_cache: if layers > 2 {
                (0..plane).map(|_| Vec::new()).collect()
            } else {
                Vec::new()
            },
            via_scratch: Vec::new(),
            heap: Heap::default(),
            pool: ReferencePool::default(),
            rips: Vec::new(),
            goal: -1,
            result_cells: Vec::new(),
            result_rips: Vec::new(),
            // Heap/result lengths, then attempted/completed batch pops.
            state: vec![0; 5],
        }
    }
    fn set_costs(
        &mut self,
        cell: f64,
        via: f64,
        rip: f64,
        trace: f64,
        via_rip: f64,
        greedy: f64,
        cap: f64,
    ) {
        self.cell_size = cell;
        self.via_base = via;
        self.rip_cost = rip;
        self.rip_trace = trace;
        self.rip_via = via_rip;
        self.greedy = greedy;
        self.penalty_cap = cap;
    }
    fn clear(&mut self) {
        self.heap.clear();
        self.pool.clear();
        self.rips.clear();
        self.goal = -1;
        self.result_cells.clear();
        self.result_rips.clear();
        self.via_scratch.clear();
        self.state.fill(0);
    }
    fn begin(&mut self, stamp: u32) {
        self.clear();
        if stamp <= self.stamp {
            self.visited.fill(0);
            self.h_stamp.fill(0);
            self.via_stamp.fill(0);
        }
        self.stamp = stamp;
        self.scan_radius = 0;
        for i in 0..self.offset_dr.len() {
            self.offset_flat[i] = self.offset_dr[i] * self.cols as i32 + self.offset_dc[i];
            self.scan_radius = self
                .scan_radius
                .max(self.offset_dr[i].abs())
                .max(self.offset_dc[i].abs());
        }
        let z = self.config[0] as usize;
        let row = self.config[1] as usize;
        let col = self.config[2] as usize;
        let cell = (z * self.rows + row) * self.cols + col;
        let f = self.weighted_h(cell, z, row, col);
        let id = self.pool.push(cell, 0.0, -1, -1);
        self.heap.push(f, id);
        self.state[0] = self.heap.entries.len() as u32;
    }
    fn weighted_h(&mut self, cell: usize, z: usize, row: usize, col: usize) -> f64 {
        if self.h_stamp[cell] == self.stamp {
            return self.h_value[cell];
        }
        let end_z = self.config[3] as usize;
        let er = self.config[4];
        let ec = self.config[5];
        let row = row as f64;
        let col = col as f64;
        let manhattan = (row - er).abs() + (col - ec).abs();
        let h = if z == end_z {
            manhattan * self.cell_size
        } else if self.config[0] == self.config[3] {
            manhattan * self.cell_size + self.via_base
        } else {
            let vr1 = js_max(self.config[7], js_min(self.config[8], row));
            let vc1 = js_max(self.config[9], js_min(self.config[10], col));
            let vr2 = js_max(self.config[7], js_min(self.config[8], er));
            let vc2 = js_max(self.config[9], js_min(self.config[10], ec));
            let via1 = (row - vr1).abs() + (col - vc1).abs() + (vr1 - er).abs() + (vc1 - ec).abs();
            let via2 = (row - vr2).abs() + (col - vc2).abs() + (vr2 - er).abs() + (vc2 - ec).abs();
            js_max(js_min(via1, via2), manhattan) * self.cell_size + self.via_base
        };
        let value = h * self.greedy;
        self.h_stamp[cell] = self.stamp;
        self.h_value[cell] = value;
        value
    }
    fn root_allowed(&self, id: i32) -> bool {
        id >= 0 && self.roots.get(id as usize) == Some(&1)
    }
    fn ripped_contains(&self, mut list: i32, id: i32) -> bool {
        while list >= 0 {
            let item = &self.rips[list as usize];
            if item.id == id {
                return true;
            }
            list = item.prev;
        }
        false
    }
    fn add_rip(&mut self, id: i32, prev: i32) -> i32 {
        let next = self.rips.len() as i32;
        self.rips.push(Rip { id, prev });
        next
    }
    fn via_occupants(&mut self, row: usize, col: usize) {
        let cell = row * self.cols + col;
        self.via_scratch.clear();
        if self.layers > 2 && self.via_stamp[cell] == self.stamp {
            self.via_scratch.extend_from_slice(&self.via_cache[cell]);
            return;
        }
        let radius = self.scan_radius as usize;
        let interior =
            row >= radius && col >= radius && row + radius < self.rows && col + radius < self.cols;
        let active = self.config[6] as i32;
        for z in 0..self.layers {
            let base = z * self.plane + cell;
            for i in 0..self.offset_dr.len() {
                if !interior {
                    let r = row as i32 + self.offset_dr[i];
                    let c = col as i32 + self.offset_dc[i];
                    if r < 0 || c < 0 || r >= self.rows as i32 || c >= self.cols as i32 {
                        continue;
                    }
                }
                let occ = self.used[(base as i32 + self.offset_flat[i]) as usize];
                if occ == -1 || occ == active || self.root_allowed(occ) {
                    continue;
                }
                if !self.via_scratch.contains(&occ) {
                    self.via_scratch.push(occ);
                }
            }
        }
        if self.layers > 2 {
            self.via_cache[cell].clone_from(&self.via_scratch);
            self.via_stamp[cell] = self.stamp;
        }
    }
    fn move_cost(
        &mut self,
        z: usize,
        row: usize,
        col: usize,
        nz: usize,
        nr: usize,
        nc: usize,
        ripped: i32,
    ) -> (f64, i32) {
        let mut cost = 0.0;
        let mut list = ripped;
        let flat = (nz * self.rows + nr) * self.cols + nc;
        let fixed = self.ports[flat];
        let active = self.config[6] as i32;
        if fixed >= 0 && fixed != active && !self.root_allowed(fixed) {
            if !(nz == self.config[3] as usize
                && nr == self.config[4] as usize
                && nc == self.config[5] as usize)
            {
                return (-1.0, list);
            }
        }
        if z != nz {
            cost += self.via_base;
            cost += js_min(self.penalty[nr * self.cols + nc], self.penalty_cap);
            self.via_occupants(nr, nc);
            for i in 0..self.via_scratch.len() {
                let occ = self.via_scratch[i];
                if !self.ripped_contains(list, occ) {
                    cost += self.rip_cost;
                    list = self.add_rip(occ, list);
                }
                cost += self.rip_via;
            }
        } else {
            let dr = row.abs_diff(nr);
            let dc = col.abs_diff(nc);
            cost += (if dr + dc > 1 {
                std::f64::consts::SQRT_2
            } else {
                1.0
            }) * self.cell_size;
            cost += js_min(self.penalty[nr * self.cols + nc], self.penalty_cap);
            let occ = self.used[flat];
            if occ != -1 && occ != active && !self.root_allowed(occ) {
                if !self.ripped_contains(list, occ) {
                    cost += self.rip_cost;
                    list = self.add_rip(occ, list);
                }
                cost += self.rip_trace;
            }
            if dr == 1 && dc == 1 {
                let sr = row.min(nr);
                let sc = col.min(nc);
                let backslash = (row < nr && col < nc) || (row > nr && col > nc);
                let crossing = if backslash { 1 } else { 0 };
                let index = ((nz * (self.rows - 1) + sr) * (self.cols - 1) + sc) * 2 + crossing;
                let occ = self.diagonals[index];
                if occ != -1 && occ != active && !self.root_allowed(occ) {
                    return (-1.0, list);
                }
            }
        }
        (cost, list)
    }
    fn advance(&mut self) -> u32 {
        if self.heap.entries.is_empty() {
            return 2;
        }
        let id = self.heap.pop() as usize;
        let cell = self.pool.nodes[id].cell as usize;
        if self.visited[cell] == self.stamp {
            return 0;
        }
        self.visited[cell] = self.stamp;
        let z = cell / self.plane;
        let in_plane = cell - z * self.plane;
        let row = in_plane / self.cols;
        let col = in_plane - row * self.cols;
        let g = self.pool.nodes[id].g;
        let ripped = self.pool.nodes[id].ripped;
        if z == self.config[3] as usize
            && row == self.config[4] as usize
            && col == self.config[5] as usize
        {
            self.goal = id as i32;
            return 1;
        }
        for d in 0..8 {
            let nr = row as i32 + DR[d];
            let nc = col as i32 + DC[d];
            if nr < 0 || nc < 0 || nr >= self.rows as i32 || nc >= self.cols as i32 {
                continue;
            }
            let nr = nr as usize;
            let nc = nc as usize;
            let next = (z * self.rows + nr) * self.cols + nc;
            if self.visited[next] == self.stamp {
                continue;
            }
            let (cost, list) = self.move_cost(z, row, col, z, nr, nc, ripped);
            if cost < 0.0 {
                continue;
            }
            let g2 = g + cost;
            let f2 = g2 + self.weighted_h(next, z, nr, nc);
            let id2 = self.pool.push(next, g2, id as i32, list);
            self.heap.push(f2, id2);
        }
        if row as f64 >= self.config[7]
            && row as f64 <= self.config[8]
            && col as f64 >= self.config[9]
            && col as f64 <= self.config[10]
        {
            for nz in 0..self.layers {
                if nz == z {
                    continue;
                }
                let next = (nz * self.rows + row) * self.cols + col;
                if self.visited[next] == self.stamp {
                    continue;
                }
                let (cost, list) = self.move_cost(z, row, col, nz, row, col, ripped);
                if cost < 0.0 {
                    continue;
                }
                let g2 = g + cost;
                let f2 = g2 + self.weighted_h(next, nz, row, col);
                let id2 = self.pool.push(next, g2, id as i32, list);
                self.heap.push(f2, id2);
            }
        }
        0
    }

    fn advance_many(&mut self, limit: u32) -> u32 {
        self.state[3] = 0;
        self.state[4] = 0;
        let goal_cell = ((self.config[3] as usize * self.rows + self.config[4] as usize)
            * self.cols
            + self.config[5] as usize) as f64;
        for _ in 0..limit {
            if self.heap.entries.is_empty() {
                break;
            }
            // Publish the attempt before any possibly trapping indexed read.
            // state[0] remains the last COMPLETED pop's public heap length.
            self.publish_batch_state(3, self.state[4] + 1);
            let next = self.heap.entries[0].id as usize;
            let cell = self.pool.nodes[next].cell;
            if cell == goal_cell && self.visited[cell as usize] != self.stamp {
                self.publish_batch_state(3, self.state[4]);
                break;
            }
            let status = self.advance();
            assert_eq!(status, 0, "batch must stop before terminal pops");
            self.publish_batch_state(0, self.heap.entries.len() as u32);
            self.publish_batch_state(4, self.state[4] + 1);
        }
        self.state[4]
    }

    fn publish_batch_state(&mut self, index: usize, value: u32) {
        // The host observes memory after a WASM trap. Rust's panic=abort must
        // not let LLVM discard intermediate stores as unobservable on abort.
        unsafe { self.state.as_mut_ptr().add(index).write_volatile(value) }
    }
    fn collect_goal(&mut self) {
        self.result_cells.clear();
        self.result_rips.clear();
        let mut id = self.goal;
        while id >= 0 {
            self.result_cells.push(self.pool.nodes[id as usize].cell);
            id = self.pool.nodes[id as usize].parent;
        }
        self.result_cells.reverse();
        if self.goal >= 0 {
            let mut list = self.pool.nodes[self.goal as usize].ripped;
            while list >= 0 {
                let rip = &self.rips[list as usize];
                self.result_rips.push(rip.id);
                list = rip.prev;
            }
        }
        self.state[1] = self.result_cells.len() as u32;
        self.state[2] = self.result_rips.len() as u32;
    }
}
