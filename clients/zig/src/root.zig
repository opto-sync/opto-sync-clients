pub const Client = struct {
    base_url: []const u8,
    bearer_token: ?[]const u8 = null,
    pub fn health(self: Client) bool { return self.base_url.len > 0; }
};
