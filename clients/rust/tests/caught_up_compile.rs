// Compile the runtime-neutral caught-up implementation against the crate's
// existing public protocol modules even before the surface-contract ratchet is
// promoted. This prevents the cross-runtime implementation from becoming dead,
// unchecked source while DEN-138 is under review.
mod protocol {
    pub use opto_sync_client::protocol::*;
}
mod protocol_sync {
    pub use opto_sync_client::protocol_sync::*;
}

#[path = "../src/caught_up.rs"]
mod caught_up;

#[test]
fn checkpoint_barrier_module_is_linkable() {
    let target = caught_up::AuthoritativeCheckpointTarget::new("42");
    caught_up::validate_authoritative_checkpoint_target(&target, None).unwrap();
    assert!(caught_up::checkpoint_reached("42", "42").unwrap());
}
