use axum::http::{header, StatusCode};
use axum::response::IntoResponse;
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "static/"]
struct Asset;

pub async fn static_handler(uri: axum::http::Uri) -> impl IntoResponse {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    match Asset::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path)
                .first_or_octet_stream()
                .to_string();
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, mime)],
                content.data.into_owned(),
            )
                .into_response()
        }
        None => {
            // SPA fallback: serve index.html for non-API routes
            if !path.starts_with("api/") {
                if let Some(content) = Asset::get("index.html") {
                    return (
                        StatusCode::OK,
                        [(header::CONTENT_TYPE, "text/html".to_string())],
                        content.data.into_owned(),
                    )
                        .into_response();
                }
            }
            StatusCode::NOT_FOUND.into_response()
        }
    }
}
