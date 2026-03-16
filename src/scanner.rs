use crate::tree::{FileEntry, SharedTree};
use jwalk::WalkDir;
use std::os::unix::fs::MetadataExt;
use std::path::Path;
use std::time::Instant;

const BATCH_SIZE: usize = 1000;
const PROPAGATE_INTERVAL_MS: u64 = 500;

struct BatchEntry {
    components: Vec<String>,
    size: u64,
    is_dir: bool,
}

pub async fn scan(tree: SharedTree, root_path: String) {
    let tree_clone = tree.clone();
    tokio::task::spawn_blocking(move || {
        scan_blocking(tree_clone, &root_path);
    })
    .await
    .ok();
}

fn scan_blocking(tree: SharedTree, root_path: &str) {
    let root = Path::new(root_path);

    // Get root device ID for cross-device detection
    let root_device = root.metadata().ok().map(|m| m.dev());
    {
        let mut t = tree.blocking_write();
        t.root_device = root_device;
    }

    let walker = WalkDir::new(root)
        .skip_hidden(false)
        .follow_links(false)
        .sort(false);

    let mut batch: Vec<BatchEntry> = Vec::with_capacity(BATCH_SIZE);
    let mut last_propagate = Instant::now();
    let root_path_prefix = if root_path.ends_with('/') {
        root_path.to_string()
    } else {
        format!("{}/", root_path)
    };

    for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                let rt = tokio::runtime::Handle::current();
                let tree = tree.clone();
                let err_msg = format!("{}", e);
                rt.block_on(async {
                    let mut t = tree.write().await;
                    t.errors.push(err_msg);
                });
                continue;
            }
        };

        let path = entry.path();
        let path_str = path.to_string_lossy();

        // Skip root itself
        if path_str == root_path || path_str.as_ref() == root_path.trim_end_matches('/') {
            continue;
        }

        // Get metadata
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(e) => {
                let rt = tokio::runtime::Handle::current();
                let tree = tree.clone();
                let err_msg = format!("{}: {}", path_str, e);
                rt.block_on(async {
                    let mut t = tree.write().await;
                    t.errors.push(err_msg);
                });
                continue;
            }
        };

        // Cross-device detection
        if let Some(root_dev) = root_device {
            if metadata.dev() != root_dev && metadata.is_dir() {
                // Mount point — add as a marker node but don't recurse
                let relative = path_str
                    .strip_prefix(&root_path_prefix)
                    .or_else(|| path_str.strip_prefix(root_path))
                    .unwrap_or(&path_str)
                    .trim_start_matches('/');

                let components: Vec<String> = relative.split('/').map(|s| s.to_string()).collect();
                if !components.is_empty() {
                    batch.push(BatchEntry {
                        components,
                        size: 0,
                        is_dir: true,
                    });
                }
                continue;
            }
        }

        let relative = path_str
            .strip_prefix(&root_path_prefix)
            .or_else(|| path_str.strip_prefix(root_path))
            .unwrap_or(&path_str)
            .trim_start_matches('/');

        if relative.is_empty() {
            continue;
        }

        let components: Vec<String> = relative.split('/').map(|s| s.to_string()).collect();
        let size = if metadata.is_file() {
            metadata.len()
        } else {
            0
        };
        let is_dir = metadata.is_dir();

        batch.push(BatchEntry {
            components,
            size,
            is_dir,
        });

        if batch.len() >= BATCH_SIZE {
            flush_batch(&tree, &mut batch);

            // Periodic propagation
            if last_propagate.elapsed().as_millis() >= PROPAGATE_INTERVAL_MS as u128 {
                {
                    let mut t = tree.blocking_write();
                    t.propagate_sizes();
                }
                last_propagate = Instant::now();
            }
        }
    }

    // Flush remaining
    if !batch.is_empty() {
        flush_batch(&tree, &mut batch);
    }

    // Final propagation and mark complete
    {
        let mut t = tree.blocking_write();
        t.propagate_sizes();
        t.scan_complete = true;
    }
}

fn flush_batch(tree: &SharedTree, batch: &mut Vec<BatchEntry>) {
    let mut t = tree.blocking_write();
    for entry in batch.drain(..) {
        if entry.is_dir {
            let node_id = t.get_or_create_path(&entry.components);
            t.nodes[node_id as usize].self_size += entry.size;
            t.dirs_scanned += 1;
        } else {
            // For files, ensure parent dirs exist, add size to parent, store file entry
            let file_name = entry.components.last().cloned().unwrap_or_default();
            let file_size = entry.size;
            if entry.components.len() > 1 {
                let parent_components = &entry.components[..entry.components.len() - 1];
                let parent_id = t.get_or_create_path(parent_components);
                t.nodes[parent_id as usize].self_size += file_size;
                t.nodes[parent_id as usize].own_file_count += 1;
                t.nodes[parent_id as usize].files.push(FileEntry {
                    name: file_name,
                    size: file_size,
                });
            } else {
                // File directly under root
                let root = t.root as usize;
                t.nodes[root].self_size += file_size;
                t.nodes[root].own_file_count += 1;
                t.nodes[root].files.push(FileEntry {
                    name: file_name,
                    size: file_size,
                });
            }
            t.files_scanned += 1;
        }
    }
}
