use app_shared::{reduce, Action as AppAction, AppState, LocalViewReply};
use leptos::prelude::*;
use std::future::Future;

#[derive(Clone, Copy)]
pub struct Dispatcher {
    state: RwSignal<AppState>,
    generation: RwSignal<u64>,
    request: RwSignal<u64>,
}

impl Dispatcher {
    pub fn provide() -> Self {
        let store = Self {
            state: RwSignal::new(AppState::default()),
            generation: RwSignal::new(0),
            request: RwSignal::new(0),
        };
        provide_context(store);
        store
    }
    pub fn state(self) -> ReadSignal<AppState> {
        self.state.read_only()
    }
    pub fn dispatch(self, action: AppAction) {
        self.state.update(|s| *s = reduce(s, action));
    }
    pub fn reset_session(self) {
        self.generation.update(|n| *n += 1);
        self.state.set(AppState::default());
    }
    fn current(self, generation: u64, request: u64) -> bool {
        self.generation.try_get_untracked() == Some(generation)
            && self.request.try_get_untracked() == Some(request)
    }

    /// `read` sends a request to the isolated sync owner, which returns localView.
    /// spawn_local schedules the async wait; the worker performs CPU-heavy work.
    pub fn refresh<F, Fut>(self, read: F)
    where
        F: FnOnce(u64, u64) -> Fut + 'static,
        Fut: Future<Output = Result<LocalViewReply, ()>> + 'static,
    {
        self.request.update(|n| *n += 1);
        let request = self.request.get_untracked();
        let generation = self.generation.get_untracked();
        self.dispatch(AppAction::Loading);
        leptos::task::spawn_local(async move {
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

#[component]
pub fn Users() -> impl IntoView {
    let store = expect_context::<Dispatcher>();
    let state = store.state();
    view! {
        <p>{move || format!("{} users", state.with(|s| s.users.len()))}</p>
        <p>{move || state.get().error.unwrap_or_default()}</p>
    }
}
