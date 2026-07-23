#include "syncer.h"
#include "yyjson.h"
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>

// Recursive function to deeply merge v2 into v1.
static yyjson_mut_val* merge_values(yyjson_mut_doc* doc, const char* key, yyjson_mut_val* v1, yyjson_val* v2, syncer_merge_override_cb cb) {
    // If an override callback is provided, invoke it for custom merge logic
    if (cb && key) {
        char* v1_str = yyjson_mut_val_write(v1, 0, NULL);
        char* v2_str = yyjson_val_write(v2, 0, NULL);
        
        char* override_res = cb(key, v1_str, v2_str);
        
        free(v1_str);
        free(v2_str);
        
        if (override_res) {
            // Callback provided a custom merged JSON string
            yyjson_doc* parsed_override = yyjson_read(override_res, strlen(override_res), 0);
            if (parsed_override) {
                yyjson_val* override_root = yyjson_doc_get_root(parsed_override);
                yyjson_mut_val* mut_res = yyjson_val_mut_copy(doc, override_root);
                yyjson_doc_free(parsed_override);
                free(override_res);
                return mut_res;
            }
            free(override_res);
        }
    }

    // If both are objects, deeply merge them
    if (yyjson_mut_is_obj(v1) && yyjson_is_obj(v2)) {
        yyjson_obj_iter iter;
        yyjson_obj_iter_init(v2, &iter);
        yyjson_val* k2;
        yyjson_val* val2;
        
        while ((k2 = yyjson_obj_iter_next(&iter))) {
            val2 = yyjson_obj_iter_get_val(k2);
            const char* key_str = yyjson_get_str(k2);
            yyjson_mut_val* val1 = yyjson_mut_obj_get(v1, key_str);
            
            if (val1) {
                // Key exists in both, merge recursively
                yyjson_mut_val* merged = merge_values(doc, key_str, val1, val2, cb);
                yyjson_mut_obj_put(v1, yyjson_mut_str(doc, key_str), merged);
            } else {
                // Key only exists in v2, copy it over to v1
                yyjson_mut_val* mut_val2 = yyjson_val_mut_copy(doc, val2);
                yyjson_mut_obj_add(v1, yyjson_mut_str(doc, key_str), mut_val2);
            }
        }
        return v1;
    }
    
    // Otherwise, v2 completely overwrites v1 (arrays, primitives, etc.)
    return yyjson_val_mut_copy(doc, v2);
}

char* syncer_merge_json(const char* json1, const char* json2, syncer_merge_override_cb cb) {
    if (!json1 && !json2) return NULL;
    
    if (!json1) {
        char *dup = (char*)malloc(strlen(json2) + 1);
        if (dup) strcpy(dup, json2);
        return dup;
    }
    if (!json2) {
        char *dup = (char*)malloc(strlen(json1) + 1);
        if (dup) strcpy(dup, json1);
        return dup;
    }

    yyjson_doc* doc1 = yyjson_read(json1, strlen(json1), 0);
    yyjson_doc* doc2 = yyjson_read(json2, strlen(json2), 0);
    
    if (!doc1 || !doc2) {
        if (doc1) yyjson_doc_free(doc1);
        if (doc2) yyjson_doc_free(doc2);
        return NULL;
    }

    yyjson_mut_doc* mut_doc1 = yyjson_doc_mut_copy(doc1, NULL);
    
    yyjson_mut_val* root1 = yyjson_mut_doc_get_root(mut_doc1);
    yyjson_val* root2 = yyjson_doc_get_root(doc2);
    
    yyjson_mut_val* merged_root = merge_values(mut_doc1, "$root", root1, root2, cb);
    yyjson_mut_doc_set_root(mut_doc1, merged_root);
    
    char* result = yyjson_mut_write(mut_doc1, 0, NULL);
    
    yyjson_mut_doc_free(mut_doc1);
    yyjson_doc_free(doc1);
    yyjson_doc_free(doc2);
    
    return result;
}

void syncer_free(void* ptr) {
    if (ptr) {
        free(ptr);
    }
}
