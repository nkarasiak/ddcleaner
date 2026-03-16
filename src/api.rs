use crate::scanner;
use crate::tree::SharedTree;
use axum::extract::Query;
use axum::http::StatusCode;
use axum::response::sse::{Event, Sse};
use axum::response::Json;
use axum::Extension;
use humansize::{format_size, BINARY};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::convert::Infallible;
use std::time::Duration;
use tokio_stream::wrappers::IntervalStream;
use tokio_stream::StreamExt;

#[derive(Deserialize)]
pub struct ScanQuery {
    pub path: String,
}

#[derive(Deserialize)]
pub struct TreeQuery {
    pub path: Option<String>,
    #[allow(dead_code)]
    pub depth: Option<u32>,
}

#[derive(Serialize)]
pub struct StatusResponse {
    pub files_scanned: u64,
    pub dirs_scanned: u64,
    pub total_size: u64,
    pub total_size_human: String,
    pub elapsed_secs: f64,
    pub scan_complete: bool,
    pub error_count: usize,
    pub root_path: String,
    pub node_count: usize,
}

#[derive(Serialize)]
pub struct TreeChild {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub size_human: String,
    pub percent: f64,
    pub file_count: u64,
    pub dir_count: u64,
    pub has_children: bool,
}

#[derive(Serialize)]
pub struct TreeResponse {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub size_human: String,
    pub file_count: u64,
    pub dir_count: u64,
    pub children: Vec<TreeChild>,
    pub scan_complete: bool,
    pub elapsed_secs: f64,
}

#[derive(Serialize)]
pub struct ErrorsResponse {
    pub errors: Vec<String>,
    pub count: usize,
}

pub async fn handle_scan(
    Extension(tree): Extension<SharedTree>,
    Query(query): Query<ScanQuery>,
) -> Result<Json<StatusResponse>, StatusCode> {
    {
        let t = tree.read().await;
        if !t.scan_complete && t.files_scanned > 0 {
            return Err(StatusCode::CONFLICT);
        }
    }

    // Create new tree and start scan
    let path = query.path.clone();
    let new_tree = crate::tree::DirTree::new(path.clone());
    {
        let mut t = tree.write().await;
        *t = new_tree;
    }

    let tree_clone = tree.clone();
    tokio::spawn(async move {
        scanner::scan(tree_clone, path).await;
    });

    let t = tree.read().await;
    Ok(Json(StatusResponse {
        files_scanned: t.files_scanned,
        dirs_scanned: t.dirs_scanned,
        total_size: t.total_size,
        total_size_human: format_size(t.total_size, BINARY),
        elapsed_secs: t.elapsed_secs(),
        scan_complete: t.scan_complete,
        error_count: t.errors.len(),
        root_path: t.root_path.clone(),
        node_count: t.nodes.len(),
    }))
}

pub async fn handle_status(
    Extension(tree): Extension<SharedTree>,
) -> Json<StatusResponse> {
    let t = tree.read().await;
    Json(StatusResponse {
        files_scanned: t.files_scanned,
        dirs_scanned: t.dirs_scanned,
        total_size: t.total_size,
        total_size_human: format_size(t.total_size, BINARY),
        elapsed_secs: t.elapsed_secs(),
        scan_complete: t.scan_complete,
        error_count: t.errors.len(),
        root_path: t.root_path.clone(),
        node_count: t.nodes.len(),
    })
}

pub async fn handle_tree(
    Extension(tree): Extension<SharedTree>,
    Query(query): Query<TreeQuery>,
) -> Result<Json<TreeResponse>, StatusCode> {
    let t = tree.read().await;

    let path = query.path.clone().unwrap_or_else(|| t.root_path.clone());
    let node_id = t.resolve_path(&path).ok_or(StatusCode::NOT_FOUND)?;
    let node = &t.nodes[node_id as usize];

    let parent_size = if node.size > 0 { node.size } else { 1 };

    let mut children: Vec<TreeChild> = node
        .children
        .iter()
        .map(|&child_id| {
            let child = &t.nodes[child_id as usize];
            let child_path = t.get_full_path(child_id);
            TreeChild {
                name: child.name.clone(),
                path: child_path,
                size: child.size,
                size_human: format_size(child.size, BINARY),
                percent: (child.size as f64 / parent_size as f64) * 100.0,
                file_count: child.file_count,
                dir_count: child.dir_count,
                has_children: !child.children.is_empty(),
            }
        })
        .collect();

    // Include direct files as children too
    let node_path = if path.ends_with('/') {
        path.clone()
    } else {
        format!("{}/", path)
    };
    for file in &node.files {
        children.push(TreeChild {
            name: file.name.clone(),
            path: format!("{}{}", node_path, file.name),
            size: file.size,
            size_human: format_size(file.size, BINARY),
            percent: (file.size as f64 / parent_size as f64) * 100.0,
            file_count: 1,
            dir_count: 0,
            has_children: false,
        });
    }

    children.sort_by(|a, b| b.size.cmp(&a.size));

    Ok(Json(TreeResponse {
        path: path.clone(),
        name: node.name.clone(),
        size: node.size,
        size_human: format_size(node.size, BINARY),
        file_count: node.file_count,
        dir_count: node.dir_count,
        children,
        scan_complete: t.scan_complete,
        elapsed_secs: t.elapsed_secs(),
    }))
}

pub async fn handle_errors(
    Extension(tree): Extension<SharedTree>,
) -> Json<ErrorsResponse> {
    let t = tree.read().await;
    Json(ErrorsResponse {
        count: t.errors.len(),
        errors: t.errors.clone(),
    })
}

pub async fn handle_events(
    Extension(tree): Extension<SharedTree>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let stream = IntervalStream::new(tokio::time::interval(Duration::from_millis(500))).map(
        move |_| {
            let tree = tree.clone();
            async move {
                let t = tree.read().await;
                let data = serde_json::json!({
                    "type": if t.scan_complete { "complete" } else { "progress" },
                    "files_scanned": t.files_scanned,
                    "dirs_scanned": t.dirs_scanned,
                    "total_size": t.total_size,
                    "total_size_human": format_size(t.total_size, BINARY),
                    "elapsed_secs": t.elapsed_secs(),
                    "scan_complete": t.scan_complete,
                    "error_count": t.errors.len(),
                    "node_count": t.nodes.len(),
                });
                Ok::<_, Infallible>(Event::default().data(data.to_string()))
            }
        },
    );

    // Need to resolve the futures
    let stream = stream.then(|fut| fut);

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}

// --- Open in file manager ---

#[derive(Deserialize)]
pub struct OpenQuery {
    pub path: String,
}

pub async fn handle_open(Query(query): Query<OpenQuery>) -> StatusCode {
    let path = std::path::Path::new(&query.path);
    let dir = if path.is_dir() {
        &query.path
    } else {
        path.parent()
            .map(|p| p.to_str().unwrap_or("/"))
            .unwrap_or("/")
    };
    match std::process::Command::new("xdg-open").arg(dir).spawn() {
        Ok(_) => StatusCode::OK,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

// --- Smart cleanup detection ---

#[derive(Serialize)]
pub struct SmartItem {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub size_human: String,
    pub category: String,
    pub description: String,
    pub file_count: u64,
}

#[derive(Serialize)]
pub struct SmartResponse {
    pub items: Vec<SmartItem>,
    pub total_size: u64,
    pub total_size_human: String,
}

pub async fn handle_smart(
    Extension(tree): Extension<SharedTree>,
) -> Json<SmartResponse> {
    let t = tree.read().await;

    // Known cleanup patterns: (name match, category, description)
    let patterns: Vec<(&dyn Fn(&str, &str) -> bool, &str, &str)> = vec![
        (&|name: &str, _: &str| name == ".cache" || name == "__pycache__" || name == ".pytest_cache", "cache", "Application cache"),
        (&|name: &str, _: &str| name == "Cache" || name == "CachedData" || name == "CachedExtensions", "cache", "Application cache"),
        (&|name: &str, _: &str| name == "cache" && !name.contains('.'), "cache", "Cache directory"),
        (&|name: &str, _: &str| name == "node_modules", "deps", "Node.js dependencies"),
        (&|name: &str, _: &str| name == "target" || name == "build" || name == "dist", "build", "Build artifacts"),
        (&|name: &str, _: &str| name == ".Trash" || name.starts_with(".Trash-"), "trash", "Trash / recycle bin"),
        (&|name: &str, _: &str| name == "tmp" || name == "temp" || name == ".tmp", "temp", "Temporary files"),
        (&|name: &str, _: &str| name == ".tox" || name == ".mypy_cache" || name == ".ruff_cache", "cache", "Python tool cache"),
        (&|name: &str, _: &str| name == "archive-v0" || name == "wheels-v1", "cache", "UV/pip cache"),
        (&|name: &str, path: &str| name == "http-cache-v2" && path.contains("uv"), "cache", "UV HTTP cache"),
        (&|_: &str, path: &str| path.contains("/.cache/pip"), "cache", "Pip cache"),
        (&|name: &str, _: &str| name == ".npm" || name == ".yarn", "cache", "Package manager cache"),
        (&|name: &str, _: &str| name == "log" || name == "logs" || name == ".log", "logs", "Log files"),
        (&|name: &str, _: &str| name.ends_with(".dist-info"), "metadata", "Package metadata"),
    ];

    let min_size: u64 = 10 * 1024 * 1024; // 10 MiB minimum
    let mut items: Vec<SmartItem> = Vec::new();
    let mut seen_paths: HashSet<String> = HashSet::new();

    // Walk all nodes
    for node_id in 0..t.nodes.len() {
        let node = &t.nodes[node_id];
        if node.size < min_size {
            continue;
        }
        let full_path = t.get_full_path(node_id as u32);

        // Skip if an ancestor is already flagged
        if seen_paths.iter().any(|p| full_path.starts_with(p) && full_path != *p) {
            continue;
        }

        for (matcher, category, description) in &patterns {
            if matcher(&node.name, &full_path) {
                // Remove any children paths already added
                items.retain(|i| !i.path.starts_with(&full_path) || i.path == full_path);
                seen_paths.insert(full_path.clone());

                items.push(SmartItem {
                    path: full_path.clone(),
                    name: node.name.clone(),
                    size: node.size,
                    size_human: format_size(node.size, BINARY),
                    category: category.to_string(),
                    description: description.to_string(),
                    file_count: node.file_count,
                });
                break;
            }
        }
    }

    // Also flag large files (>100 MiB) in certain patterns
    let large_file_min: u64 = 100 * 1024 * 1024;
    for node_id in 0..t.nodes.len() {
        let node = &t.nodes[node_id];
        for file in &node.files {
            if file.size < large_file_min {
                continue;
            }
            let lname = file.name.to_lowercase();
            let (cat, desc) = if lname.ends_with(".log") || lname.ends_with(".log.gz") {
                ("logs", "Large log file")
            } else if lname.ends_with(".tmp") || lname.ends_with(".temp") {
                ("temp", "Large temporary file")
            } else if lname.ends_with(".core") || lname.starts_with("core.") {
                ("temp", "Core dump")
            } else {
                continue;
            };
            let dir_path = t.get_full_path(node_id as u32);
            let file_path = format!("{}/{}", dir_path, file.name);
            if seen_paths.iter().any(|p| file_path.starts_with(p)) {
                continue;
            }
            items.push(SmartItem {
                path: file_path,
                name: file.name.clone(),
                size: file.size,
                size_human: format_size(file.size, BINARY),
                category: cat.to_string(),
                description: desc.to_string(),
                file_count: 1,
            });
        }
    }

    items.sort_by(|a, b| b.size.cmp(&a.size));
    let total: u64 = items.iter().map(|i| i.size).sum();

    Json(SmartResponse {
        items,
        total_size: total,
        total_size_human: format_size(total, BINARY),
    })
}
