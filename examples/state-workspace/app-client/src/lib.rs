//! Native framework signals own UI state. No external store dependency.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
#[cfg(not(target_arch = "wasm32"))]
compile_error!("app-client is browser-only; build with --target wasm32-unknown-unknown");

#[cfg(feature = "dioxus-ui")]
pub mod dioxus_app;
#[cfg(feature = "leptos-ui")]
pub mod leptos_app;
