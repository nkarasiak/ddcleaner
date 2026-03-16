use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

pub type NodeId = u32;
pub type SharedTree = Arc<RwLock<DirTree>>;

#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DirNode {
    pub name: String,
    pub size: u64,
    pub self_size: u64,
    pub own_file_count: u64,
    pub file_count: u64,
    pub dir_count: u64,
    #[serde(skip)]
    pub children: Vec<NodeId>,
    #[serde(skip)]
    pub parent: Option<NodeId>,
    #[serde(skip)]
    pub child_map: HashMap<String, NodeId>,
    #[serde(skip)]
    pub files: Vec<FileEntry>,
}

impl DirNode {
    pub fn new(name: String, parent: Option<NodeId>) -> Self {
        Self {
            name,
            size: 0,
            self_size: 0,
            own_file_count: 0,
            file_count: 0,
            dir_count: 0,
            children: Vec::new(),
            parent,
            child_map: HashMap::new(),
            files: Vec::new(),
        }
    }
}

pub struct DirTree {
    pub nodes: Vec<DirNode>,
    pub root: NodeId,
    pub scan_complete: bool,
    pub scan_started: Instant,
    pub files_scanned: u64,
    pub dirs_scanned: u64,
    pub total_size: u64,
    pub errors: Vec<String>,
    pub root_path: String,
    pub root_device: Option<u64>,
}

impl DirTree {
    pub fn new(root_path: String) -> Self {
        let root_name = if root_path == "/" {
            "/".to_string()
        } else {
            root_path
                .trim_end_matches('/')
                .rsplit('/')
                .next()
                .unwrap_or(&root_path)
                .to_string()
        };
        let root_node = DirNode::new(root_name, None);
        Self {
            nodes: vec![root_node],
            root: 0,
            scan_complete: false,
            scan_started: Instant::now(),
            files_scanned: 0,
            dirs_scanned: 1,
            total_size: 0,
            errors: Vec::new(),
            root_path,
            root_device: None,
        }
    }

    pub fn add_child(&mut self, parent: NodeId, name: String) -> NodeId {
        if let Some(&existing) = self.nodes[parent as usize].child_map.get(&name) {
            return existing;
        }
        let id = self.nodes.len() as NodeId;
        let node = DirNode::new(name.clone(), Some(parent));
        self.nodes.push(node);
        self.nodes[parent as usize].children.push(id);
        self.nodes[parent as usize].child_map.insert(name, id);
        id
    }

    pub fn get_or_create_path(&mut self, path_components: &[String]) -> NodeId {
        let mut current = self.root;
        for component in path_components {
            current = self.add_child(current, component.clone());
        }
        current
    }

    pub fn propagate_sizes(&mut self) {
        let len = self.nodes.len();
        // Bottom-up pass: process children before parents
        // Since children always have higher indices than parents, iterate in reverse
        for i in (0..len).rev() {
            let children = self.nodes[i].children.clone();
            let mut child_size: u64 = 0;
            let mut child_files: u64 = 0;
            let mut child_dirs: u64 = 0;
            for &child_id in &children {
                let child = &self.nodes[child_id as usize];
                child_size += child.size;
                child_files += child.file_count;
                child_dirs += child.dir_count;
            }
            self.nodes[i].size = self.nodes[i].self_size + child_size;
            self.nodes[i].file_count = self.nodes[i].own_file_count + child_files;
            self.nodes[i].dir_count = children.len() as u64 + child_dirs;
        }
        // Update total
        self.total_size = self.nodes[self.root as usize].size;
    }

    pub fn resolve_path(&self, path: &str) -> Option<NodeId> {
        if path.is_empty() || path == "/" || path == &self.root_path {
            return Some(self.root);
        }

        // Strip root_path prefix if present
        let relative = if path.starts_with(&self.root_path) {
            path[self.root_path.len()..].trim_start_matches('/')
        } else {
            path.trim_start_matches('/')
        };

        if relative.is_empty() {
            return Some(self.root);
        }

        let mut current = self.root;
        for component in relative.split('/') {
            if component.is_empty() {
                continue;
            }
            if let Some(&child_id) = self.nodes[current as usize].child_map.get(component) {
                current = child_id;
            } else {
                return None;
            }
        }
        Some(current)
    }

    pub fn get_full_path(&self, node_id: NodeId) -> String {
        let mut parts = Vec::new();
        let mut current = node_id;
        loop {
            parts.push(self.nodes[current as usize].name.clone());
            if let Some(parent) = self.nodes[current as usize].parent {
                current = parent;
            } else {
                break;
            }
        }
        parts.reverse();
        if parts.len() == 1 {
            return self.root_path.clone();
        }
        // The first part is the root name, replace with root_path
        let rest: Vec<&str> = parts[1..].iter().map(|s| s.as_str()).collect();
        format!(
            "{}/{}",
            self.root_path.trim_end_matches('/'),
            rest.join("/")
        )
    }

    pub fn elapsed_secs(&self) -> f64 {
        self.scan_started.elapsed().as_secs_f64()
    }
}
