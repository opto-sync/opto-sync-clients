use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppState {
    pub users: Vec<User>,
    pub busy: bool,
    pub error: Option<String>,
}

pub enum Action {
    Loading,
    HydrateLocalView(Vec<User>),
    Failed,
}

/// Pure and synchronous. A hydration value must already include pending writes.
pub fn reduce(state: &AppState, action: Action) -> AppState {
    match action {
        Action::Loading => AppState {
            busy: true,
            error: None,
            ..state.clone()
        },
        Action::HydrateLocalView(users) => AppState {
            users,
            busy: false,
            error: None,
        },
        Action::Failed => AppState {
            busy: false,
            error: Some("Sync unavailable".into()),
            ..state.clone()
        },
    }
}

/// Worker DTO boundary, deliberately containing no UI signals or credentials.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LocalViewReply {
    pub generation: u64,
    pub request_id: u64,
    pub users: Vec<User>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reducer_preserves_users_when_an_effect_fails() {
        let state = AppState {
            users: vec![User {
                id: "1".into(),
                name: "Pending edit".into(),
            }],
            ..Default::default()
        };
        let failed = reduce(&reduce(&state, Action::Loading), Action::Failed);
        assert_eq!(failed.users, state.users);
        assert!(!failed.busy);
        assert!(failed.error.is_some());
    }
}
