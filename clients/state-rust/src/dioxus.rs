//! Dioxus 0.7 read-only selectors, scoped to the component's hook lifetime.
use crate::StateStore;
use ::dioxus::prelude::{use_hook, use_signal, ReadSignal, ReadableExt, WritableExt};
use std::rc::Rc;

/// Keep the store identity and selector fixed for this hook's lifetime. Scope a
/// store per app/session through context, not a process-global server signal.
pub fn use_store_selector<S: 'static, A: 'static, T: Clone + PartialEq + 'static>(
    store: StateStore<S, A>,
    selector: impl Fn(&S) -> T + 'static,
) -> ReadSignal<T> {
    let signal = use_signal(|| selector(&store.state()));
    let _subscription = use_hook(move || {
        Rc::new(
            store
                .select(selector, move |value| {
                    let mut write = signal;
                    if *write.peek() != value {
                        write.set(value);
                    }
                })
                .expect("store selector must be created outside a transition"),
        )
    });
    signal.into()
}
