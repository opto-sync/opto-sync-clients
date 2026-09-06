#[cfg(feature = "leptos")]
#[test]
fn leptos_owner_releases_selector() {
    use leptos::prelude::*;
    use opto_sync_state::{leptos::store_selector, StateStore};
    let store = StateStore::new(0, |_, n| n);
    let owner = Owner::new();
    let read = owner.with(|| store_selector(&store, |s| *s).unwrap());
    assert_eq!(read.get_untracked(), 0);
    store.dispatch(2).unwrap();
    assert_eq!(read.get_untracked(), 2);
    owner.cleanup();
    // A leaked subscription would attempt to update a disposed arena signal.
    store.dispatch(3).unwrap();
    assert_eq!(*store.state(), 3);
}

#[cfg(feature = "dioxus")]
#[test]
fn dioxus_hook_releases_selector() {
    use dioxus::prelude::*;
    use opto_sync_state::{dioxus::use_store_selector, StateStore};
    use std::cell::RefCell;

    type TestStore = StateStore<i32, i32>;
    thread_local! {
        static STORE: TestStore = StateStore::new(0, |_, n| n);
        static READ: RefCell<Option<ReadSignal<i32>>> = const { RefCell::new(None) };
    }
    fn app() -> Element {
        let store = STORE.with(Clone::clone);
        let read = use_store_selector(store, |s| *s);
        READ.with(|r| *r.borrow_mut() = Some(read));
        // Read tracks the signal even when this test renders no DOM nodes.
        let _ = read();
        VNode::empty()
    }
    let mut dom = VirtualDom::new(app);
    dom.rebuild_in_place();
    STORE.with(|s| s.dispatch(4).unwrap());
    dom.render_immediate(&mut dioxus::core::NoOpMutations);
    READ.with(|r| assert_eq!(*r.borrow().as_ref().unwrap().peek(), 4));
    drop(dom);
    STORE.with(|s| {
        s.dispatch(5).unwrap();
        assert_eq!(*s.state(), 5);
    });
}
