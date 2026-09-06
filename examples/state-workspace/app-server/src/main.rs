//! Read-only MASH boundary example, not a replacement for protocol-v1 endpoints.
#[cfg(target_arch = "wasm32")]
compile_error!("app-server is native-only");

use app_shared::User;
use axum::{extract::State, http::StatusCode, routing::get, Json, Router};
use maud::{html, Markup, DOCTYPE};
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

async fn read_users(db: &SqlitePool) -> Result<Vec<User>, StatusCode> {
    let rows = sqlx::query_as::<_, (String, String)>("SELECT id, name FROM users ORDER BY id")
        .fetch_all(db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(rows
        .into_iter()
        .map(|(id, name)| User { id, name })
        .collect())
}

async fn users_json(State(db): State<SqlitePool>) -> Result<Json<Vec<User>>, StatusCode> {
    Ok(Json(read_users(&db).await?))
}

async fn users_fragment(State(db): State<SqlitePool>) -> Result<Markup, StatusCode> {
    let users = read_users(&db).await?;
    Ok(html! { ul { @for user in users { li data-id=(user.id) { (user.name) } } } })
}

async fn index() -> Markup {
    html! {
        (DOCTYPE)
        html { head { title { "Opto-sync MASH boundary example" } }
            body {
                h1 { "Users" }
                // Serve a reviewed HTMX asset from your host's normal asset pipeline.
                button hx-get="/users" hx-target="#users" { "Refresh users" }
                div id="users" {}
                a href="/users" { "Open users without JavaScript" }
            }
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;
    sqlx::query("CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL)")
        .execute(&db)
        .await?;
    sqlx::query("INSERT INTO users VALUES ('demo', 'Example user')")
        .execute(&db)
        .await?;
    let app = Router::new()
        .route("/", get(index))
        .route("/users", get(users_fragment))
        .route("/api/users", get(users_json))
        .with_state(db);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:3100").await?;
    axum::serve(listener, app).await?;
    Ok(())
}
