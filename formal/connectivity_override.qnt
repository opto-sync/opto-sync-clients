// Finite connectivity override/cache machine shared by browser, Dart, and
// native mobile bridges. Platform observations continue to update the cached
// automatic state while total-offline mode remains authoritative.
module connectivity_override {
  type LinkState = Unknown | Offline | Link | Internet
  type Mode = Automatic | ForcedOffline

  type State = {
    automatic_state: LinkState,
    automatic_verified: bool,
    exposed_state: LinkState,
    exposed_verified: bool,
    mode: Mode,
    emitted: bool,
    saw_forced_override: bool,
    saw_cached_internet: bool,
    saw_cached_restore: bool,
  }

  var s: State

  action init = {
    s' = {
      automatic_state: Unknown,
      automatic_verified: false,
      exposed_state: Unknown,
      exposed_verified: false,
      mode: Automatic,
      emitted: false,
      saw_forced_override: false,
      saw_cached_internet: false,
      saw_cached_restore: false,
    }
  }

  def published(next_state) = {
    ...s,
    automatic_state: next_state,
    automatic_verified: next_state == Internet,
    exposed_state:
      if (s.mode == Automatic) next_state else Offline,
    exposed_verified:
      s.mode == Automatic and next_state == Internet,
    emitted:
      s.mode == Automatic and or {
        s.exposed_state != next_state,
        s.exposed_verified != (next_state == Internet),
      },
    saw_cached_internet:
      s.saw_cached_internet or and {
        s.mode == ForcedOffline,
        next_state == Internet,
      },
  }

  action publish_unknown = s' = published(Unknown)
  action publish_offline = s' = published(Offline)
  action publish_link = s' = published(Link)
  action publish_internet = s' = published(Internet)

  // Mode setters are total and idempotent: repeating the selected mode must
  // neither change the exposed snapshot nor notify semantic listeners.
  action force_offline = s' = {
    ...s,
    exposed_state: if (s.mode == Automatic) Offline else s.exposed_state,
    exposed_verified:
      if (s.mode == Automatic) false else s.exposed_verified,
    mode: ForcedOffline,
    emitted: s.mode == Automatic,
    saw_forced_override:
      s.saw_forced_override or and {
        s.mode == Automatic,
        s.exposed_state == Internet,
      },
  }

  action restore_automatic = s' = {
    ...s,
    exposed_state:
      if (s.mode == ForcedOffline) s.automatic_state else s.exposed_state,
    exposed_verified:
      if (s.mode == ForcedOffline) s.automatic_verified
      else s.exposed_verified,
    mode: Automatic,
    emitted: s.mode == ForcedOffline,
    saw_cached_restore:
      s.saw_cached_restore or and {
        s.mode == ForcedOffline,
        s.saw_cached_internet,
        s.automatic_state == Internet,
      },
  }

  action idle = s' = { ...s, emitted: false }

  action step = any {
    publish_unknown,
    publish_offline,
    publish_link,
    publish_internet,
    force_offline,
    restore_automatic,
    idle,
  }

  val forced_offline_is_authoritative = or {
    s.mode != ForcedOffline,
    and {
      s.exposed_state == Offline,
      not(s.exposed_verified),
    },
  }

  val automatic_mode_exposes_the_cache = or {
    s.mode != Automatic,
    and {
      s.exposed_state == s.automatic_state,
      s.exposed_verified == s.automatic_verified,
    },
  }

  val verification_matches_internet = and {
    s.automatic_verified == (s.automatic_state == Internet),
    s.exposed_verified == and {
      s.mode == Automatic,
      s.exposed_state == Internet,
    },
  }

  val connectivity_safety = and {
    forced_offline_is_authoritative,
    automatic_mode_exposes_the_cache,
    verification_matches_internet,
  }

  val forced_override_reached = s.saw_forced_override
  val cached_internet_reached = s.saw_cached_internet
  val cached_restore_reached = s.saw_cached_restore
}
