use opto_sync_state::{StateEffect, StateStore, StoreError};
use serde_json::{json, Value};
use std::{
    cell::RefCell,
    collections::HashMap,
    future::Future,
    pin::pin,
    rc::Rc,
    task::{Context, Poll, Waker},
};

fn initial() -> Value {
    json!({"count": 0, "status": "idle"})
}
fn reduce(s: &Value, action: Value) -> Result<Value, StoreError> {
    let mut next = s.clone();
    match action["type"].as_str().unwrap() {
        "add" => {
            next["count"] = json!(s["count"].as_i64().unwrap() + action["value"].as_i64().unwrap())
        }
        "hydrate" => next["count"] = action["value"].clone(),
        "status" => next["status"] = action["value"].clone(),
        _ => return Err(StoreError::Reducer("unknown action")),
    }
    Ok(next)
}

#[test]
fn portable_corpus() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../conformance/state-store/scenario.json"
    ))
    .unwrap();
    assert_eq!(corpus["contract"], "opto.state-store.v1");
    let store = StateStore::try_new(initial(), reduce);
    let selections = Rc::new(RefCell::new(Vec::<Value>::new()));
    let observed = selections.clone();
    let mut subscription = store
        .select(
            |s| s["count"].clone(),
            move |v| observed.borrow_mut().push(v),
        )
        .unwrap();
    let mut effects: HashMap<String, StateEffect<Value, Value>> = HashMap::new();
    for step in corpus["steps"].as_array().unwrap() {
        match step["op"].as_str().unwrap() {
            "dispatch" => store.dispatch(step["action"].clone()).unwrap(),
            "begin" => {
                effects.insert(
                    step["id"].as_str().unwrap().into(),
                    store.begin_effect(step["key"].as_str().unwrap()).unwrap(),
                );
            }
            "effect" => assert_eq!(
                effects[step["id"].as_str().unwrap()]
                    .dispatch(step["action"].clone())
                    .unwrap(),
                step["accepted"].as_bool().unwrap()
            ),
            "close" => effects[step["id"].as_str().unwrap()].close(),
            "reset" => store.reset(initial()).unwrap(),
            "unsubscribe" => {
                subscription.cancel();
                subscription.cancel();
            }
            "dispose" => store.dispose().unwrap(),
            _ => panic!("unknown step"),
        }
        assert_eq!(store.revision(), step["revision"].as_u64().unwrap());
        for key in ["count", "status"] {
            if !step[key].is_null() {
                assert_eq!(store.state()[key], step[key]);
            }
        }
        if !step["selections"].is_null() {
            assert_eq!(json!(*selections.borrow()), step["selections"]);
        }
    }
    assert_eq!(
        store.dispatch(json!({"type":"add","value":1})),
        Err(StoreError::Disposed)
    );
    assert_eq!(store.reset(initial()), Err(StoreError::Disposed));
    assert!(matches!(
        store.begin_effect("late"),
        Err(StoreError::Disposed)
    ));
    assert!(matches!(
        store.select(|s| s.clone(), |_| {}),
        Err(StoreError::Disposed)
    ));
}

#[test]
fn reducer_errors_are_atomic_and_reentrant_transitions_fail() {
    let store = StateStore::try_new(initial(), reduce);
    assert_eq!(
        store.dispatch(json!({"type":"bad"})),
        Err(StoreError::Reducer("unknown action"))
    );
    assert_eq!(store.revision(), 0);
    assert_eq!(*store.state(), initial());
    let nested = store.clone();
    let _sub = store
        .select(
            |s| s["count"].clone(),
            move |_| {
                assert_eq!(
                    nested.dispatch(json!({"type":"add","value":10})),
                    Err(StoreError::Reentrant)
                );
                assert_eq!(nested.reset(initial()), Err(StoreError::Reentrant));
            },
        )
        .unwrap();
    store.dispatch(json!({"type":"add","value":1})).unwrap();
    assert_eq!(store.state()["count"], 1);
    assert_eq!(store.revision(), 1);
}

#[test]
fn subscriptions_and_effects_are_raii_and_do_not_retain_the_store() {
    let store = StateStore::new(0, |s, a| s + a);
    let seen = Rc::new(RefCell::new(vec![]));
    let observed = seen.clone();
    let sub = store
        .select(|s| *s, move |n| observed.borrow_mut().push(n))
        .unwrap();
    store.dispatch(1).unwrap();
    drop(sub);
    store.dispatch(1).unwrap();
    assert_eq!(*seen.borrow(), vec![0, 1]);
    let effect = store.begin_effect("fetch").unwrap();
    drop(store);
    assert!(!effect.is_current());
    assert_eq!(effect.dispatch(99), Ok(false));
}

// A manually-polled future makes races deterministic without an executor or sleeps.
struct Deferred(Rc<RefCell<Option<i32>>>);
impl Future for Deferred {
    type Output = Result<i32, StoreError>;
    fn poll(self: std::pin::Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Self::Output> {
        match self.0.borrow_mut().take() {
            Some(v) => Poll::Ready(Ok(v)),
            None => Poll::Pending,
        }
    }
}

#[test]
fn projection_races_and_reset_are_fenced() {
    let store = StateStore::new(0, |_, value| value);
    let old = Rc::new(RefCell::new(None));
    let mut first = pin!(store.project_local_view("view", || Deferred(old.clone()), |v| v));
    let mut context = Context::from_waker(Waker::noop());
    assert_eq!(first.as_mut().poll(&mut context), Poll::Pending);
    let mut second = pin!(store.project_local_view("view", || async { Ok(7) }, |v| v));
    assert_eq!(second.as_mut().poll(&mut context), Poll::Ready(Ok(true)));
    *old.borrow_mut() = Some(99);
    assert_eq!(first.as_mut().poll(&mut context), Poll::Ready(Ok(false)));
    assert_eq!(*store.state(), 7);
    let rotating = Rc::new(RefCell::new(None));
    let mut pending = pin!(store.project_local_view("view", || Deferred(rotating.clone()), |v| v));
    assert_eq!(pending.as_mut().poll(&mut context), Poll::Pending);
    store.reset(0).unwrap();
    *rotating.borrow_mut() = Some(88);
    assert_eq!(pending.as_mut().poll(&mut context), Poll::Ready(Ok(false)));
    assert_eq!(*store.state(), 0);
}
