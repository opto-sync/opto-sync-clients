//! Leptos 0.8 read-only selectors, scoped to the current reactive owner.
use crate::{StateStore, StoreError};
use ::leptos::prelude::{signal_local, LocalStorage, ReadSignal, Set, StoredValue};

/// Call once under the component/session owner. Cleanup drops the subscription.
/// The writable signal stays private; components dispatch actions to the store.
pub fn store_selector<S: 'static, A: 'static, T: Clone + PartialEq + 'static>(
    store: &StateStore<S, A>,
    selector: impl Fn(&S) -> T + 'static,
) -> Result<ReadSignal<T, LocalStorage>, StoreError> {
    let (read, write) = signal_local(selector(&store.state()));
    let subscription = store.select(selector, move |value| write.set(value))?;
    // StoredValue owns the !Send RAII subscription and drops it with its owner.
    // on_cleanup requires Send + Sync and cannot capture this UI-thread value.
    StoredValue::new_local(subscription);
    Ok(read)
}
