use opto_sync_connectivity::{
    ConnectivityMode, ConnectivitySource, ConnectivityState, ConnectivityWatcher,
    SaveMetadata, SaveOperation, SaveSignals,
};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

#[test]
fn forced_offline_hides_automatic_updates_until_restored() {
    let watcher = ConnectivityWatcher::default();
    let transitions = Arc::new(Mutex::new(Vec::new()));
    let observed = transitions.clone();
    let _subscription = watcher.subscribe(false, move |next, previous| {
        observed.lock().unwrap().push((previous, next));
    });

    watcher.publish(ConnectivityState::Link, ConnectivitySource::Platform);
    watcher.publish(ConnectivityState::Link, ConnectivitySource::Platform);
    watcher.set_total_offline(true);
    watcher.publish_verified_internet();

    let forced = watcher.snapshot();
    assert_eq!(forced.mode, ConnectivityMode::Offline);
    assert_eq!(forced.state, ConnectivityState::Offline);
    assert_eq!(transitions.lock().unwrap().len(), 2);

    watcher.set_total_offline(false);
    let restored = watcher.snapshot();
    assert_eq!(restored.mode, ConnectivityMode::Automatic);
    assert_eq!(restored.state, ConnectivityState::Internet);
    assert!(restored.has_verified_internet());
    assert_eq!(transitions.lock().unwrap().len(), 3);
}

#[test]
fn save_hooks_run_after_success_and_failures_are_isolated() {
    let watcher = ConnectivityWatcher::new(ConnectivityState::Internet);
    let signals = SaveSignals::new(watcher.clone());
    let durable = Arc::new(AtomicBool::new(false));
    let saves = Arc::new(AtomicUsize::new(0));
    let online_saves = Arc::new(AtomicUsize::new(0));
    let wakes = Arc::new(AtomicUsize::new(0));

    let durable_at_callback = durable.clone();
    let save_count = saves.clone();
    let _save_subscription = signals.on_save(move |_| {
        assert!(durable_at_callback.load(Ordering::Acquire));
        save_count.fetch_add(1, Ordering::AcqRel);
        panic!("consumer hook failure must not reject a committed save");
    });
    let online_count = online_saves.clone();
    let _online_subscription = signals.on_online_save(move |_| {
        online_count.fetch_add(1, Ordering::AcqRel);
    });
    let wake_count = wakes.clone();
    signals.set_wake_hint(Some(move || {
        wake_count.fetch_add(1, Ordering::AcqRel);
    }));

    let result: Result<u64, ()> = signals.after_durable_save_sync(
        SaveMetadata::new("docs", "one", SaveOperation::Upsert),
        || {
            durable.store(true, Ordering::Release);
            Ok(42)
        },
        |queue_id| queue_id.to_string(),
    );

    assert_eq!(result, Ok(42));
    assert_eq!(saves.load(Ordering::Acquire), 1);
    assert_eq!(online_saves.load(Ordering::Acquire), 1);
    assert_eq!(wakes.load(Ordering::Acquire), 1);

    signals.set_total_offline(true);
    signals.notify_after_durable_save(
        "43",
        SaveMetadata::new("docs", "two", SaveOperation::Delete),
    );
    assert_eq!(saves.load(Ordering::Acquire), 2);
    assert_eq!(online_saves.load(Ordering::Acquire), 1);
    assert_eq!(wakes.load(Ordering::Acquire), 1);

    watcher.publish_verified_internet();
    signals.set_total_offline(false);
    assert_eq!(wakes.load(Ordering::Acquire), 2);
}

#[test]
fn failed_durable_save_emits_nothing() {
    let watcher = ConnectivityWatcher::new(ConnectivityState::Internet);
    let signals = SaveSignals::new(watcher);
    let saves = Arc::new(AtomicUsize::new(0));
    let observed = saves.clone();
    let _subscription = signals.on_save(move |_| {
        observed.fetch_add(1, Ordering::AcqRel);
    });

    let result: Result<(), &'static str> = signals.after_durable_save_sync(
        SaveMetadata::new("docs", "bad", SaveOperation::Upsert),
        || Err("not committed"),
        |_| "unused".to_owned(),
    );

    assert_eq!(result, Err("not committed"));
    assert_eq!(saves.load(Ordering::Acquire), 0);
}
