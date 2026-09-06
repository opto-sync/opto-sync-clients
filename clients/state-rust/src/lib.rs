//! UI-thread state management for native Rust and wasm32-unknown-unknown.
//! No database, transport, framework, executor, or reconciliation dependencies.
//! State must be immutable (including through interior mutability). Run effects
//! outside reducers; hydrate the existing protocol client's complete local view.

#[cfg(feature = "dioxus")]
pub mod dioxus;
#[cfg(feature = "leptos")]
pub mod leptos;

use std::{
    cell::{Cell, RefCell},
    collections::{BTreeMap, HashMap},
    future::Future,
    rc::{Rc, Weak},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StoreError {
    Disposed,
    Reentrant,
    Reducer(&'static str),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for StoreError {}

type Reducer<S, A> = dyn Fn(&S, A) -> Result<S, StoreError>;
type Listener<S> = dyn Fn(&S);

struct Inner<S, A> {
    state: RefCell<Rc<S>>,
    reducer: Box<Reducer<S, A>>,
    revision: Cell<u64>,
    busy: Cell<bool>,
    disposed: Cell<bool>,
    listeners: RefCell<BTreeMap<u64, Rc<Listener<S>>>>,
    next_listener: Cell<u64>,
    effects: RefCell<HashMap<String, Rc<()>>>,
}

// Also clears the reentrancy guard while unwinding on native targets.
struct Transition<'a>(&'a Cell<bool>);
impl Drop for Transition<'_> {
    fn drop(&mut self) {
        self.0.set(false);
    }
}

/// Clone shares the same store. This type deliberately stays on the UI thread.
pub struct StateStore<S, A>(Rc<Inner<S, A>>);
impl<S, A> Clone for StateStore<S, A> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl<S: 'static, A: 'static> StateStore<S, A> {
    pub fn new(initial: S, reducer: impl Fn(&S, A) -> S + 'static) -> Self {
        Self::try_new(initial, move |state, action| Ok(reducer(state, action)))
    }

    pub fn try_new(initial: S, reducer: impl Fn(&S, A) -> Result<S, StoreError> + 'static) -> Self {
        Self(Rc::new(Inner {
            state: RefCell::new(Rc::new(initial)),
            reducer: Box::new(reducer),
            revision: Cell::new(0),
            busy: Cell::new(false),
            disposed: Cell::new(false),
            listeners: RefCell::new(BTreeMap::new()),
            next_listener: Cell::new(0),
            effects: RefCell::new(HashMap::new()),
        }))
    }

    pub fn state(&self) -> Rc<S> {
        self.0.state.borrow().clone()
    }
    pub fn revision(&self) -> u64 {
        self.0.revision.get()
    }
    pub fn disposed(&self) -> bool {
        self.0.disposed.get()
    }

    fn check(&self) -> Result<(), StoreError> {
        if self.disposed() {
            Err(StoreError::Disposed)
        } else if self.0.busy.get() {
            Err(StoreError::Reentrant)
        } else {
            Ok(())
        }
    }

    fn transition(&self) -> Result<Transition<'_>, StoreError> {
        self.check()?;
        self.0.busy.set(true);
        Ok(Transition(&self.0.busy))
    }

    fn notify(&self) {
        let listeners: Vec<_> = self
            .0
            .listeners
            .borrow()
            .iter()
            .map(|(id, listener)| (*id, listener.clone()))
            .collect();
        let state = self.state();
        for (id, listener) in listeners {
            if self.0.listeners.borrow().contains_key(&id) {
                listener(&state);
            }
        }
    }

    /// Fallible reducers leave state/revision unchanged. Observers must not panic.
    pub fn dispatch(&self, action: A) -> Result<(), StoreError> {
        let _transition = self.transition()?;
        let next = (self.0.reducer)(&self.state(), action)?;
        *self.0.state.borrow_mut() = Rc::new(next);
        self.0.revision.set(self.revision() + 1);
        self.notify();
        Ok(())
    }

    /// Clear user state and invalidate effects on session replacement/logout.
    pub fn reset(&self, initial: S) -> Result<(), StoreError> {
        let _transition = self.transition()?;
        self.0.effects.borrow_mut().clear();
        *self.0.state.borrow_mut() = Rc::new(initial);
        self.0.revision.set(self.revision() + 1);
        self.notify();
        Ok(())
    }

    pub fn select<T: Clone + PartialEq + 'static>(
        &self,
        selector: impl Fn(&S) -> T + 'static,
        listener: impl Fn(T) + 'static,
    ) -> Result<Subscription, StoreError> {
        self.select_by(selector, listener, |left, right| left == right)
    }

    /// Replay once, then emit distinct selections. Retain the RAII subscription.
    pub fn select_by<T: Clone + 'static>(
        &self,
        selector: impl Fn(&S) -> T + 'static,
        listener: impl Fn(T) + 'static,
        same: impl Fn(&T, &T) -> bool + 'static,
    ) -> Result<Subscription, StoreError> {
        let _transition = self.transition()?;
        let previous = selector(&self.state());
        listener(previous.clone());
        let previous = RefCell::new(previous);
        let notify = move |state: &S| {
            let next = selector(state);
            if same(&previous.borrow(), &next) {
                return;
            }
            *previous.borrow_mut() = next.clone();
            listener(next);
        };
        let id = self.0.next_listener.get();
        self.0.next_listener.set(id + 1);
        self.0.listeners.borrow_mut().insert(id, Rc::new(notify));
        let weak = Rc::downgrade(&self.0);
        Ok(Subscription(Some(Box::new(move || {
            if let Some(inner) = weak.upgrade() {
                inner.listeners.borrow_mut().remove(&id);
            }
        }))))
    }

    pub fn begin_effect(&self, key: impl Into<String>) -> Result<StateEffect<S, A>, StoreError> {
        self.check()?;
        let key = key.into();
        let token = Rc::new(());
        self.0
            .effects
            .borrow_mut()
            .insert(key.clone(), token.clone());
        Ok(StateEffect {
            store: Rc::downgrade(&self.0),
            key,
            token,
        })
    }

    /// Read an already-rebased local view. Superseded reads cannot hydrate state.
    pub async fn project_local_view<T, E>(
        &self,
        key: impl Into<String>,
        read: impl FnOnce() -> E,
        action: impl FnOnce(T) -> A,
    ) -> Result<bool, StoreError>
    where
        E: Future<Output = Result<T, StoreError>>,
    {
        let effect = self.begin_effect(key)?;
        let value = read().await?;
        if !effect.is_current() {
            return Ok(false);
        }
        effect.dispatch(action(value))
    }

    pub fn dispose(&self) -> Result<(), StoreError> {
        if self.disposed() {
            return Ok(());
        }
        self.check()?;
        self.0.disposed.set(true);
        self.0.effects.borrow_mut().clear();
        self.0.listeners.borrow_mut().clear();
        Ok(())
    }
}

#[must_use = "dropping a subscription unsubscribes it"]
pub struct Subscription(Option<Box<dyn FnOnce()>>);
impl Subscription {
    pub fn cancel(&mut self) {
        if let Some(cancel) = self.0.take() {
            cancel();
        }
    }
}
impl Drop for Subscription {
    fn drop(&mut self) {
        self.cancel();
    }
}

/// A logical cancellation fence. Dropping it finishes the effect; it never
/// acknowledges, removes, or cancels an already-started durable queue write.
pub struct StateEffect<S, A> {
    store: Weak<Inner<S, A>>,
    key: String,
    token: Rc<()>,
}
impl<S, A> StateEffect<S, A> {
    pub fn is_current(&self) -> bool {
        self.store.upgrade().is_some_and(|inner| {
            !inner.disposed.get()
                && inner
                    .effects
                    .borrow()
                    .get(&self.key)
                    .is_some_and(|token| Rc::ptr_eq(token, &self.token))
        })
    }
    pub fn close(&self) {
        if self.is_current() {
            if let Some(inner) = self.store.upgrade() {
                inner.effects.borrow_mut().remove(&self.key);
            }
        }
    }
}
impl<S: 'static, A: 'static> StateEffect<S, A> {
    pub fn dispatch(&self, action: A) -> Result<bool, StoreError> {
        if !self.is_current() {
            return Ok(false);
        }
        let Some(inner) = self.store.upgrade() else {
            return Ok(false);
        };
        StateStore(inner).dispatch(action)?;
        Ok(true)
    }
}
impl<S, A> Drop for StateEffect<S, A> {
    fn drop(&mut self) {
        self.close();
    }
}
