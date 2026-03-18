use crate::tree::{FileEntry, SharedTree};
use jwalk::WalkDir;
use std::collections::HashSet;
use std::os::unix::fs::MetadataExt;
use std::path::Path;
use std::time::{Instant, UNIX_EPOCH};

const BATCH_SIZE: usize = 1000;
const PROPAGATE_INTERVAL_MS: u64 = 500;

/// Build a set of mount points backed by virtual/pseudo filesystems that should be skipped.
fn virtual_mount_points() -> HashSet<String> {
    let mut skip = HashSet::new();
    let mounts = match std::fs::read_to_string("/proc/mounts") {
        Ok(s) => s,
        Err(_) => return skip,
    };
    let virtual_fs: HashSet<&str> = [
        "proc", "sysfs", "devtmpfs", "devpts", "tmpfs", "cgroup", "cgroup2",
        "securityfs", "pstore", "bpf", "tracefs", "debugfs", "hugetlbfs",
        "mqueue", "configfs", "fusectl", "ramfs", "binfmt_misc", "nsfs",
        "rpc_pipefs", "nfsd", "efivarfs", "autofs", "overlay", "squashfs",
    ].into_iter().collect();
    for line in mounts.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 && virtual_fs.contains(parts[2]) {
            skip.insert(parts[1].to_string());
        }
    }
    skip
}

struct BatchEntry {
    components: Vec<String>,
    size: u64,
    is_dir: bool,
    mtime: u64,
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

    // Build set of virtual filesystem mount points to skip
    let virtual_mounts = virtual_mount_points();

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

        // Skip virtual filesystem mount points and everything beneath them
        {
            let ps = path_str.as_ref();
            let is_virtual = virtual_mounts.contains(ps)
                || virtual_mounts.iter().any(|vm| ps.starts_with(vm.as_str()) && ps.as_bytes().get(vm.len()) == Some(&b'/'));
            if is_virtual {
                continue;
            }
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
                        mtime: 0,
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
            // Use actual disk blocks (handles sparse files correctly)
            // blocks() returns 512-byte blocks on Linux
            let blocks_size = metadata.blocks() * 512;
            if blocks_size > 0 { blocks_size } else { metadata.len() }
        } else {
            0
        };
        let is_dir = metadata.is_dir();
        let mtime = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        batch.push(BatchEntry {
            components,
            size,
            is_dir,
            mtime,
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
            if entry.mtime > 0 {
                let node = &mut t.nodes[node_id as usize];
                if entry.mtime > node.newest_mtime {
                    node.newest_mtime = entry.mtime;
                }
                if entry.mtime < node.oldest_mtime {
                    node.oldest_mtime = entry.mtime;
                }
            }
            t.dirs_scanned += 1;
        } else {
            // For files, ensure parent dirs exist, add size to parent, store file entry
            let file_name = entry.components.last().cloned().unwrap_or_default();
            let file_size = entry.size;
            let file_mtime = entry.mtime;
            let parent_idx = if entry.components.len() > 1 {
                let parent_components = &entry.components[..entry.components.len() - 1];
                t.get_or_create_path(parent_components) as usize
            } else {
                t.root as usize
            };
            t.nodes[parent_idx].self_size += file_size;
            t.nodes[parent_idx].own_file_count += 1;
            if file_mtime > t.nodes[parent_idx].newest_mtime {
                t.nodes[parent_idx].newest_mtime = file_mtime;
            }
            if file_mtime < t.nodes[parent_idx].oldest_mtime {
                t.nodes[parent_idx].oldest_mtime = file_mtime;
            }
            t.nodes[parent_idx].files.push(FileEntry {
                name: file_name,
                size: file_size,
                mtime: file_mtime,
            });
            t.files_scanned += 1;
        }
    }
}
