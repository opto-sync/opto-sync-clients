use app_shared::{reduce, Action as AppAction, AppState, LocalViewReply};
use dioxus::prelude::*;
use std::future::Future;

#[derive(Clone, Copy)]
pub struct Dispatcher {
    state: Signal<AppState>,
    generation: Signal<u64>,
    request: Signal<u64>,
}

impl Dispatcher {
    pub fn state(self) -> ReadSignal<AppState> {
        self.state.into()
    }
    pub fn dispatch(mut self, action: AppAction) {
        let next = reduce(&self.state.peek(), action);
        self.state.set(next);
    }
    pub fn reset_session(mut self) {
        self.generation += 1;
        self.state.set(AppState::default());
    }
    fn current(self, generation: u64, request: u64) -> bool {
        self.generation.try_peek().is_ok_and(|n| *n == generation)
            && self.request.try_peek().is_ok_and(|n| *n == request)
    }
    /// Can also be called from a use_coroutine message loop. The async executor
    /// waits for the worker; it does not move CPU work off the UI thread itself.
    pub fn refresh<F, Fut>(mut self, read: F)
    where
        F: FnOnce(u64, u64) -> Fut + 'static,
        Fut: Future<Output = Result<LocalViewReply, ()>> + 'static,
    {
        self.request += 1;
        let request = *self.request.peek();
        let generation = *self.generation.peek();
        self.dispatch(AppAction::Loading);
        spawn(async move {
            let result = read(generation, request).await;
            if !self.current(generation, request) {
                return;
            }
            match result {
                Ok(reply) if reply.generation == generation && reply.request_id == request => {
                    self.dispatch(AppAction::HydrateLocalView(reply.users))
                }
                _ => self.dispatch(AppAction::Failed),
            }
        });
    }
}

/// A context per app/session also works for Dioxus native hosts. A GlobalSignal
/// is optional for a single-session client; never share tenant data across SSR requests.
pub fn use_dispatcher() -> Dispatcher {
    let state = use_signal(AppState::default);
    let generation = use_signal(|| 0);
    let request = use_signal(|| 0);
    use_context_provider(|| Dispatcher {
        state,
        generation,
        request,
    })
}

#[component]
pub fn Users() -> Element {
    let store = use_context::<Dispatcher>();
    let state = store.state();
    let count = state.read().users.len();
    rsx! { p { "{count} users" } }
}
