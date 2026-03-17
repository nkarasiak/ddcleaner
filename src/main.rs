mod api;
mod embedded;
mod scanner;
mod tree;

use axum::routing::{get, post};
use axum::Extension;
use axum::Router;
use clap::Parser;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Parser)]
#[command(name = "ddcleaner", version = "1.0.0", about = "Blazing fast disk usage analyzer")]
struct Args {
    /// Path to scan
    #[arg(default_value = ".")]
    path: String,

    /// Port to listen on
    #[arg(short, long, default_value_t = 8080)]
    port: u16,

    /// Don't auto-open browser
    #[arg(long)]
    no_open: bool,
}

#[tokio::main]
async fn main() {
    let args = Args::parse();

    // Resolve path to absolute
    let scan_path = std::fs::canonicalize(&args.path)
        .unwrap_or_else(|_| std::path::PathBuf::from(&args.path))
        .to_string_lossy()
        .to_string();

    println!("ddcleaner v1.0.0 — read-only disk analyzer");
    println!("Scanning: {}", scan_path);

    let dir_tree = tree::DirTree::new(scan_path.clone());
    let shared_tree: tree::SharedTree = Arc::new(RwLock::new(dir_tree));

    // Start scan immediately
    let scan_tree = shared_tree.clone();
    let scan_path_clone = scan_path.clone();
    tokio::spawn(async move {
        scanner::scan(scan_tree, scan_path_clone).await;
    });

    let app = Router::new()
        .route("/api/scan", get(api::handle_scan))
        .route("/api/status", get(api::handle_status))
        .route("/api/tree", get(api::handle_tree))
        .route("/api/errors", get(api::handle_errors))
        .route("/api/events", get(api::handle_events))
        .route("/api/open", get(api::handle_open))
        .route("/api/smart", get(api::handle_smart))
        .route("/api/search", get(api::handle_search))
        .route("/api/types", get(api::handle_types))
        .route("/api/delete", post(api::handle_delete))
        .route("/api/diskinfo", get(api::handle_diskinfo))
        .fallback(embedded::static_handler)
        .layer(Extension(shared_tree));

    let addr = format!("127.0.0.1:{}", args.port);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    println!("Server: http://{}", addr);

    if !args.no_open {
        let url = format!("http://{}", addr);
        let _ = std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn();
    }

    axum::serve(listener, app).await.unwrap();
}
