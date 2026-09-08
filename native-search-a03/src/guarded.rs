//! Production-only live-graph eligibility at the next affected expansion.
//! The original search and direct ABI entry points retain their exact behavior.
use super::*;

impl Kernel {
    /// Public graph arrays were synchronously copied before this quantum. Check
    /// every graph value the next expansion could use before any search write or
    /// throwable host call. Unsupported values return control to the JS suffix.
    pub fn next_graph_row_supported(&self) -> bool {
        if self.state.heap.n == 0 {
            return true;
        }
        // Corrupt private heap/pool state belongs to the original search's trap
        // path. Checked peeks must not introduce an earlier exception or pop.
        let Some(entry) = self.state.heap.entries.first() else {
            return true;
        };
        let Some(node) = self.state.pool.nodes.get(entry.id as usize) else {
            return true;
        };
        if node.z < 0
            || node.z as usize >= self.problem.layers
            || node.cell < 0
            || node.cell as usize >= self.problem.plane
        {
            return true;
        }
        let Some(flat) = (node.z as usize)
            .checked_mul(self.problem.plane)
            .and_then(|base| base.checked_add(node.cell as usize))
        else {
            return true;
        };
        let Some(&visited) = self.state.visited.get(flat) else {
            return true;
        };
        if visited == self.search.stamp
            || (node.z == self.search.end_z && node.cell == self.search.end_cell)
        {
            return true;
        }
        let finite_center = |cell: usize| {
            self.problem.x.get(cell).is_some_and(|v| v.is_finite())
                && self.problem.y.get(cell).is_some_and(|v| v.is_finite())
        };
        let cell = node.cell as usize;
        if !finite_center(cell) || !finite_center(self.search.end_cell as usize) {
            return false;
        }
        let (Some(&first), Some(&end)) = (
            self.problem.offsets.get(cell),
            self.problem.offsets.get(cell + 1),
        ) else {
            return false;
        };
        if first < 0
            || end < first
            || end as usize > self.problem.neighbors.len()
            || end as usize > self.problem.edge_costs.len()
        {
            return false;
        }
        for index in first as usize..end as usize {
            let next = self.problem.neighbors[index];
            if next < 0
                || next as usize >= self.problem.plane
                || self.problem.edge_costs[index].is_nan()
                || !finite_center(next as usize)
            {
                return false;
            }
        }
        true
    }

    /// Match the original batch loop, stopping without an attempted pop when a
    /// live graph row requires JS. Completed prefixes and imported throws retain
    /// the original attempt/completion counters and complete partial backing.
    pub fn advance_many_guarded<H: Host>(
        &mut self,
        host: &mut H,
        limit: u32,
    ) -> Result<(u32, bool), H::Error> {
        self.publish_batch(0, 0);
        for _ in 0..limit {
            if self.state.heap.n == 0 {
                break;
            }
            if !self.next_graph_row_supported() {
                return Ok((self.batch.completed, true));
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
        Ok((self.batch.completed, false))
    }
}
