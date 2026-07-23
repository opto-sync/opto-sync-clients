use std::ffi::{c_char, c_void, CStr, CString};

pub type MergeOverrideCb = extern "C" fn(
    key: *const c_char,
    val1: *const c_char,
    val2: *const c_char,
) -> *mut c_char;

extern "C" {
    pub fn syncer_merge_json(
        json1: *const c_char,
        json2: *const c_char,
        cb: Option<MergeOverrideCb>,
    ) -> *mut c_char;

    pub fn syncer_free(ptr: *mut c_void);
}

pub fn merge_json(json1: &str, json2: &str) -> String {
    let c_json1 = CString::new(json1).unwrap();
    let c_json2 = CString::new(json2).unwrap();
    
    unsafe {
        let ptr = syncer_merge_json(c_json1.as_ptr(), c_json2.as_ptr(), None);
        if ptr.is_null() {
            return String::new();
        }
        let res = CStr::from_ptr(ptr).to_string_lossy().into_owned();
        syncer_free(ptr as *mut c_void);
        res
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merge() {
        let j1 = r#"{"a": 1, "b": {"c": 2}}"#;
        let j2 = r#"{"b": {"d": 3}, "e": 4}"#;
        let res = merge_json(j1, j2);
        
        // Let's print out what yyjson generated.
        println!("Merged: {}", res);
        
        // Assertions checking that keys from both sides are present
        assert!(res.contains("\"a\":1"));
        assert!(res.contains("\"c\":2"));
        assert!(res.contains("\"d\":3"));
        assert!(res.contains("\"e\":4"));
    }
}
