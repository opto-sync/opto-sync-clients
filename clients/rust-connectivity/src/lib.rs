//! UI-agnostic connectivity and post-save signals for opto-sync.
//!
//! The core deliberately separates link availability from verified internet
//! reachability. Platform callbacks publish observations; applications may
//! force total-offline mode at any time. Save hooks are metadata-only and run
//! after the caller's durable queue operation succeeds.

use std::collections::BTreeMap;
use std::future::Future;
use std::panic::{catch_unwind, AssertUnwindSafe};
#[cfg(not(target_arch = "wasm32"))]
use std::sync::atomic::AtomicBool;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
#[cfg(not(target_arch = "wasm32"))]
use std::thread::{self, JoinHandle};
#[cfg(not(target_arch = "wasm32"))]
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

/// Runtime-neutral connectivity state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectivityState {
    Unknown,
    Offline,
    /// A network path exists, but end-to-end internet/server reachability has
    /// not been verified.
    Link,
    /// A bounded probe or trusted platform validator confirmed reachability.
    Internet,
}

/// Automatic observation or an explicit, authoritative offline override.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectivityMode {
    Automatic,
    Offline,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectivitySource {
    Initial,
    Manual,
    Platform,
    Probe,
    ForcedOffline,
}

/// Immutable state delivered to listeners and attached to save events.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConnectivitySnapshot {
    pub state: ConnectivityState,
    pub mode: ConnectivityMode,
    pub source: ConnectivitySource,
    pub changed_at_ms: u64,
    pub verified_at_ms: Option<u64>,
}

impl ConnectivitySnapshot {
    pub fn has_verified_internet(self) -> bool {
        self.mode == ConnectivityMode::Automatic && self.state == ConnectivityState::Internet
    }
}

type ConnectivityCallback =
    Arc<dyn Fn(ConnectivitySnapshot, ConnectivitySnapshot) + Send + Sync + 'static>;

struct WatcherState {
    current: ConnectivitySnapshot,
    automatic: ConnectivitySnapshot,
}

struct WatcherInner {
    state: Mutex<WatcherState>,
    listeners: Mutex<BTreeMap<usize, ConnectivityCallback>>,
    next_listener_id: AtomicUsize,
}

/// Cloneable, thread-safe connectivity state and subscription source.
#[derive(Clone)]
pub struct ConnectivityWatcher {
    inner: Arc<WatcherInner>,
}

impl Default for ConnectivityWatcher {
    fn default() -> Self {
        Self::new(ConnectivityState::Unknown)
    }
}

impl ConnectivityWatcher {
    pub fn new(initial_state: ConnectivityState) -> Self {
        let now = now_ms();
        let initial = ConnectivitySnapshot {
            state: initial_state,
            mode: ConnectivityMode::Automatic,
            source: ConnectivitySource::Initial,
            changed_at_ms: now,
            verified_at_ms: (initial_state == ConnectivityState::Internet).then_some(now),
        };
        Self {
            inner: Arc::new(WatcherInner {
                state: Mutex::new(WatcherState {
                    current: initial,
                    automatic: initial,
                }),
                listeners: Mutex::new(BTreeMap::new()),
                next_listener_id: AtomicUsize::new(1),
            }),
        }
    }

    pub fn snapshot(&self) -> ConnectivitySnapshot {
        lock(&self.inner.state).current
    }

    /// Subscribe to semantic state/mode changes. Callback panics are isolated
    /// from state publication when the build uses unwinding panics.
    pub fn subscribe<F>(&self, emit_current: bool, listener: F) -> ConnectivitySubscription
    where
        F: Fn(ConnectivitySnapshot, ConnectivitySnapshot) + Send + Sync + 'static,
    {
        let callback: ConnectivityCallback = Arc::new(listener);
        let id = self.inner.next_listener_id.fetch_add(1, Ordering::Relaxed);
        lock(&self.inner.listeners).insert(id, callback.clone());
        if emit_current {
            let snapshot = self.snapshot();
            invoke_connectivity(&callback, snapshot, snapshot);
        }
        ConnectivitySubscription {
            inner: Arc::downgrade(&self.inner),
            id,
        }
    }

    /// Record a platform observation. Internet state should be used only after
    /// a trusted validator or end-to-end probe succeeds.
    pub fn publish(
        &self,
        state: ConnectivityState,
        source: ConnectivitySource,
    ) -> ConnectivitySnapshot {
        self.publish_at(state, source, now_ms())
    }

    pub fn publish_verified_internet(&self) -> ConnectivitySnapshot {
        self.publish(ConnectivityState::Internet, ConnectivitySource::Probe)
    }

    fn publish_at(
        &self,
        state: ConnectivityState,
        source: ConnectivitySource,
        observed_at_ms: u64,
    ) -> ConnectivitySnapshot {
        let (automatic, expose) = {
            let mut guard = lock(&self.inner.state);
            let changed_at_ms = if guard.automatic.state == state {
                guard.automatic.changed_at_ms
            } else {
                observed_at_ms
            };
            let automatic = ConnectivitySnapshot {
                state,
                mode: ConnectivityMode::Automatic,
                source,
                changed_at_ms,
                verified_at_ms: (state == ConnectivityState::Internet).then_some(observed_at_ms),
            };
            guard.automatic = automatic;
            (automatic, guard.current.mode == ConnectivityMode::Automatic)
        };
        if expose {
            self.transition(automatic)
        } else {
            self.snapshot()
        }
    }

    pub fn set_total_offline(&self, enabled: bool) -> ConnectivitySnapshot {
        let current = self.snapshot();
        if enabled == (current.mode == ConnectivityMode::Offline) {
            return current;
        }
        if enabled {
            return self.transition(ConnectivitySnapshot {
                state: ConnectivityState::Offline,
                mode: ConnectivityMode::Offline,
                source: ConnectivitySource::ForcedOffline,
                changed_at_ms: now_ms(),
                verified_at_ms: None,
            });
        }
        let automatic = lock(&self.inner.state).automatic;
        self.transition(ConnectivitySnapshot {
            changed_at_ms: now_ms(),
            ..automatic
        })
    }

    /// Spawn a native periodic observer. The probe reports the canonical state
    /// directly so callers can distinguish no link, captive/limited link, and
    /// verified internet. Total-offline mode suppresses probe execution.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn spawn_probe<F>(&self, interval: Duration, probe: F) -> Result<ProbeHandle, ProbeError>
    where
        F: Fn() -> ConnectivityState + Send + Sync + 'static,
    {
        if interval.is_zero() {
            return Err(ProbeError::ZeroInterval);
        }
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let watcher = self.clone();
        let probe = Arc::new(probe);
        let thread = thread::Builder::new()
            .name("opto-sync-connectivity".to_owned())
            .spawn(move || {
                while !stopped.load(Ordering::Acquire) {
                    if watcher.snapshot().mode == ConnectivityMode::Automatic {
                        let state = catch_unwind(AssertUnwindSafe(|| probe()))
                            .unwrap_or(ConnectivityState::Unknown);
                        let source = if state == ConnectivityState::Internet {
                            ConnectivitySource::Probe
                        } else {
                            ConnectivitySource::Platform
                        };
                        watcher.publish(state, source);
                    }
                    sleep_until_stopped(interval, &stopped);
                }
            })
            .map_err(ProbeError::Spawn)?;
        Ok(ProbeHandle {
            stop,
            thread: Some(thread),
        })
    }

    fn transition(&self, candidate: ConnectivitySnapshot) -> ConnectivitySnapshot {
        let (previous, next, changed) = {
            let mut state = lock(&self.inner.state);
            let previous = state.current;
            let changed = previous.state != candidate.state || previous.mode != candidate.mode;
            let next = ConnectivitySnapshot {
                changed_at_ms: if changed {
                    candidate.changed_at_ms
                } else {
                    previous.changed_at_ms
                },
                ..candidate
            };
            state.current = next;
            (previous, next, changed)
        };

        if changed {
            let callbacks = lock(&self.inner.listeners)
                .values()
                .cloned()
                .collect::<Vec<_>>();
            for callback in callbacks {
                invoke_connectivity(&callback, next, previous);
            }
        }
        next
    }
}

/// Dropping a subscription removes its callback.
pub struct ConnectivitySubscription {
    inner: Weak<WatcherInner>,
    id: usize,
}

impl Drop for ConnectivitySubscription {
    fn drop(&mut self) {
        if let Some(inner) = self.inner.upgrade() {
            lock(&inner.listeners).remove(&self.id);
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug)]
pub enum ProbeError {
    ZeroInterval,
    Spawn(std::io::Error),
}

#[cfg(not(target_arch = "wasm32"))]
impl std::fmt::Display for ProbeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ZeroInterval => formatter.write_str("probe interval must be non-zero"),
            Self::Spawn(error) => write!(formatter, "failed to spawn connectivity probe: {error}"),
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl std::error::Error for ProbeError {}

/// Stops and joins a native periodic probe on drop.
#[cfg(not(target_arch = "wasm32"))]
pub struct ProbeHandle {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

#[cfg(not(target_arch = "wasm32"))]
impl ProbeHandle {
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl Drop for ProbeHandle {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveOperation {
    Upsert,
    Delete,
}

/// Owned metadata accepted before a durable queue operation begins.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SaveMetadata {
    pub table_name: String,
    pub record_id: String,
    pub operation: SaveOperation,
}

impl SaveMetadata {
    pub fn new(
        table_name: impl Into<String>,
        record_id: impl Into<String>,
        operation: SaveOperation,
    ) -> Self {
        Self {
            table_name: table_name.into(),
            record_id: record_id.into(),
            operation,
        }
    }
}

/// Metadata-only event emitted after a durable local queue commit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalSaveEvent {
    pub queue_id: String,
    pub table_name: String,
    pub record_id: String,
    pub operation: SaveOperation,
    pub saved_at_ms: u64,
    pub connectivity: ConnectivitySnapshot,
}

type SaveCallback = Arc<dyn Fn(LocalSaveEvent) + Send + Sync + 'static>;
type WakeCallback = Arc<dyn Fn() + Send + Sync + 'static>;

#[derive(Clone, Copy)]
enum SaveListenerKind {
    All,
    Online,
}

struct SaveSignalsInner {
    watcher: ConnectivityWatcher,
    save_listeners: Mutex<BTreeMap<usize, SaveCallback>>,
    online_listeners: Mutex<BTreeMap<usize, SaveCallback>>,
    wake_hint: Mutex<Option<WakeCallback>>,
    next_listener_id: AtomicUsize,
    _connectivity_subscription: Mutex<Option<ConnectivitySubscription>>,
}

/// Post-commit save hooks and online-transition wake hints.
#[derive(Clone)]
pub struct SaveSignals {
    inner: Arc<SaveSignalsInner>,
}

impl SaveSignals {
    pub fn new(watcher: ConnectivityWatcher) -> Self {
        let inner = Arc::new(SaveSignalsInner {
            watcher: watcher.clone(),
            save_listeners: Mutex::new(BTreeMap::new()),
            online_listeners: Mutex::new(BTreeMap::new()),
            wake_hint: Mutex::new(None),
            next_listener_id: AtomicUsize::new(1),
            _connectivity_subscription: Mutex::new(None),
        });
        let weak = Arc::downgrade(&inner);
        let subscription = watcher.subscribe(false, move |next, previous| {
            if next.has_verified_internet() && !previous.has_verified_internet() {
                if let Some(inner) = weak.upgrade() {
                    invoke_wake(&inner);
                }
            }
        });
        *lock(&inner._connectivity_subscription) = Some(subscription);
        Self { inner }
    }

    pub fn watcher(&self) -> &ConnectivityWatcher {
        &self.inner.watcher
    }

    pub fn set_total_offline(&self, enabled: bool) -> ConnectivitySnapshot {
        self.inner.watcher.set_total_offline(enabled)
    }

    pub fn set_wake_hint<F>(&self, wake: Option<F>)
    where
        F: Fn() + Send + Sync + 'static,
    {
        *lock(&self.inner.wake_hint) = wake.map(|value| Arc::new(value) as WakeCallback);
    }

    pub fn clear_wake_hint(&self) {
        *lock(&self.inner.wake_hint) = None;
    }

    pub fn on_save<F>(&self, listener: F) -> SaveSubscription
    where
        F: Fn(LocalSaveEvent) + Send + Sync + 'static,
    {
        self.add_listener(SaveListenerKind::All, listener)
    }

    pub fn on_online_save<F>(&self, listener: F) -> SaveSubscription
    where
        F: Fn(LocalSaveEvent) + Send + Sync + 'static,
    {
        self.add_listener(SaveListenerKind::Online, listener)
    }

    /// Wrap an async durable queue operation. No event is emitted on error.
    pub async fn after_durable_save<T, E, F, Fut, Q>(
        &self,
        metadata: SaveMetadata,
        save: F,
        queue_id: Q,
    ) -> Result<T, E>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, E>>,
        Q: FnOnce(&T) -> String,
    {
        let result = save().await?;
        let queue_id = queue_id(&result);
        self.notify_after_durable_save(queue_id, metadata);
        Ok(result)
    }

    /// Synchronous counterpart to [`Self::after_durable_save`].
    pub fn after_durable_save_sync<T, E, F, Q>(
        &self,
        metadata: SaveMetadata,
        save: F,
        queue_id: Q,
    ) -> Result<T, E>
    where
        F: FnOnce() -> Result<T, E>,
        Q: FnOnce(&T) -> String,
    {
        let result = save()?;
        let queue_id = queue_id(&result);
        self.notify_after_durable_save(queue_id, metadata);
        Ok(result)
    }

    /// Use this immediately after an existing queue transaction commits.
    pub fn notify_after_durable_save(
        &self,
        queue_id: impl Into<String>,
        metadata: SaveMetadata,
    ) -> LocalSaveEvent {
        let connectivity = self.inner.watcher.snapshot();
        let event = LocalSaveEvent {
            queue_id: queue_id.into(),
            table_name: metadata.table_name,
            record_id: metadata.record_id,
            operation: metadata.operation,
            saved_at_ms: now_ms(),
            connectivity,
        };

        invoke_save_callbacks(&self.inner.save_listeners, &event);
        if connectivity.has_verified_internet() {
            invoke_save_callbacks(&self.inner.online_listeners, &event);
        }
        if connectivity.mode == ConnectivityMode::Automatic
            && connectivity.state != ConnectivityState::Offline
        {
            invoke_wake(&self.inner);
        }
        event
    }

    fn add_listener<F>(&self, kind: SaveListenerKind, listener: F) -> SaveSubscription
    where
        F: Fn(LocalSaveEvent) + Send + Sync + 'static,
    {
        let id = self.inner.next_listener_id.fetch_add(1, Ordering::Relaxed);
        let callback: SaveCallback = Arc::new(listener);
        match kind {
            SaveListenerKind::All => {
                lock(&self.inner.save_listeners).insert(id, callback);
            }
            SaveListenerKind::Online => {
                lock(&self.inner.online_listeners).insert(id, callback);
            }
        }
        SaveSubscription {
            inner: Arc::downgrade(&self.inner),
            id,
            kind,
        }
    }
}

pub struct SaveSubscription {
    inner: Weak<SaveSignalsInner>,
    id: usize,
    kind: SaveListenerKind,
}

impl Drop for SaveSubscription {
    fn drop(&mut self) {
        if let Some(inner) = self.inner.upgrade() {
            match self.kind {
                SaveListenerKind::All => {
                    lock(&inner.save_listeners).remove(&self.id);
                }
                SaveListenerKind::Online => {
                    lock(&inner.online_listeners).remove(&self.id);
                }
            }
        }
    }
}

fn invoke_connectivity(
    callback: &ConnectivityCallback,
    next: ConnectivitySnapshot,
    previous: ConnectivitySnapshot,
) {
    let _ = catch_unwind(AssertUnwindSafe(|| callback(next, previous)));
}

fn invoke_save_callbacks(callbacks: &Mutex<BTreeMap<usize, SaveCallback>>, event: &LocalSaveEvent) {
    let callbacks = lock(callbacks).values().cloned().collect::<Vec<_>>();
    for callback in callbacks {
        let event = event.clone();
        let _ = catch_unwind(AssertUnwindSafe(|| callback(event)));
    }
}

fn invoke_wake(inner: &SaveSignalsInner) {
    let wake = lock(&inner.wake_hint).clone();
    if let Some(wake) = wake {
        let _ = catch_unwind(AssertUnwindSafe(|| wake()));
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(not(target_arch = "wasm32"))]
fn sleep_until_stopped(interval: Duration, stopped: &AtomicBool) {
    const SLICE: Duration = Duration::from_millis(100);
    let mut remaining = interval;
    while !remaining.is_zero() && !stopped.load(Ordering::Acquire) {
        let sleep_for = remaining.min(SLICE);
        thread::sleep(sleep_for);
        remaining = remaining.saturating_sub(sleep_for);
    }
}

/// Browser online/offline adapter for Rust WebAssembly hosts, including Leptos
/// and Dioxus web builds. Browser events publish `Link`; call
/// `record_probe_result(true)` only after an end-to-end probe succeeds.
#[cfg(all(feature = "wasm", target_arch = "wasm32"))]
pub mod wasm {
    use super::{ConnectivitySnapshot, ConnectivitySource, ConnectivityState, ConnectivityWatcher};
    use wasm_bindgen::closure::Closure;
    use wasm_bindgen::{JsCast, JsValue};
    use web_sys::{Event, Window};

    pub struct BrowserConnectivityWatcher {
        watcher: ConnectivityWatcher,
        window: Window,
        online: Closure<dyn FnMut(Event)>,
        offline: Closure<dyn FnMut(Event)>,
    }

    impl BrowserConnectivityWatcher {
        pub fn new(watcher: ConnectivityWatcher) -> Result<Self, JsValue> {
            let window =
                web_sys::window().ok_or_else(|| JsValue::from_str("window is unavailable"))?;
            let online_watcher = watcher.clone();
            let online = Closure::wrap(Box::new(move |_event: Event| {
                if online_watcher.snapshot().mode == super::ConnectivityMode::Automatic {
                    online_watcher.publish(ConnectivityState::Link, ConnectivitySource::Platform);
                }
            }) as Box<dyn FnMut(Event)>);
            let offline_watcher = watcher.clone();
            let offline = Closure::wrap(Box::new(move |_event: Event| {
                if offline_watcher.snapshot().mode == super::ConnectivityMode::Automatic {
                    offline_watcher
                        .publish(ConnectivityState::Offline, ConnectivitySource::Platform);
                }
            }) as Box<dyn FnMut(Event)>);

            window.add_event_listener_with_callback("online", online.as_ref().unchecked_ref())?;
            if let Err(error) =
                window.add_event_listener_with_callback("offline", offline.as_ref().unchecked_ref())
            {
                let _ = window
                    .remove_event_listener_with_callback("online", online.as_ref().unchecked_ref());
                return Err(error);
            }

            let adapter = Self {
                watcher,
                window,
                online,
                offline,
            };
            adapter.refresh_link_hint();
            Ok(adapter)
        }

        pub fn watcher(&self) -> &ConnectivityWatcher {
            &self.watcher
        }

        pub fn refresh_link_hint(&self) -> ConnectivitySnapshot {
            if self.watcher.snapshot().mode == super::ConnectivityMode::Offline {
                return self.watcher.snapshot();
            }
            self.watcher.publish(
                if self.window.navigator().on_line() {
                    ConnectivityState::Link
                } else {
                    ConnectivityState::Offline
                },
                ConnectivitySource::Platform,
            )
        }

        pub fn record_probe_result(&self, reachable: bool) -> ConnectivitySnapshot {
            if self.watcher.snapshot().mode == super::ConnectivityMode::Offline {
                return self.watcher.snapshot();
            }
            if reachable {
                self.watcher.publish_verified_internet()
            } else {
                self.refresh_link_hint()
            }
        }

        pub fn set_total_offline(&self, enabled: bool) -> ConnectivitySnapshot {
            let snapshot = self.watcher.set_total_offline(enabled);
            if enabled {
                snapshot
            } else {
                self.refresh_link_hint()
            }
        }
    }

    impl Drop for BrowserConnectivityWatcher {
        fn drop(&mut self) {
            let _ = self.window.remove_event_listener_with_callback(
                "online",
                self.online.as_ref().unchecked_ref(),
            );
            let _ = self.window.remove_event_listener_with_callback(
                "offline",
                self.offline.as_ref().unchecked_ref(),
            );
        }
    }
}
