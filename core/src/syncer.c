#include "syncer.h"
#include <stdlib.h>
#include <string.h>

// Placeholder implementation.
// In the future, this should integrate a fast JSON parser like yyjson or cJSON.
// For now, it just returns a concatenated string as a mock implementation.

char* syncer_merge_json(const char* json1, const char* json2, syncer_merge_override_cb cb) {
    if (!json1 || !json2) {
        return NULL;
    }

    // Example of calling the override callback on the root object
    if (cb) {
        char* override_res = cb("$root", json1, json2);
        if (override_res) {
            return override_res;
        }
    }

    // Mock basic merge: just concatenating strings to prove FFI works.
    // Replace with yyjson/cJSON AST parsing and recursive deep mixin.
    size_t len1 = strlen(json1);
    size_t len2 = strlen(json2);
    
    char* result = (char*)malloc(len1 + len2 + 20);
    if (!result) return NULL;

    sprintf(result, "{\"merged\": [%s, %s]}", json1, json2);
    return result;
}

void syncer_free(void* ptr) {
    if (ptr) {
        free(ptr);
    }
}
