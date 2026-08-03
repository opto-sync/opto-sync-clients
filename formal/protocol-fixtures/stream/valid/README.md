# Valid streaming transcripts

`minimal-capabilities.jsonl` proves the mandatory hello capability set in its
canonical wire order:

```json
["reset", "apply", "observe", "close"]
```

The transcript closes successfully without invoking optional operations. Other
valid transcripts may advertise optional capabilities, but their arrays must
remain strict subsequences of `../capabilities.v1.json`.
