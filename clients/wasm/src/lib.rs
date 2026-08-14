#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Client { pub base_url: String, pub bearer_token: Option<String> }
impl Client {
    pub fn new(base_url: impl Into<String>, bearer_token: Option<String>) -> Self { Self { base_url: base_url.into(), bearer_token } }
    pub fn health(&self) -> bool { !self.base_url.is_empty() }
}
