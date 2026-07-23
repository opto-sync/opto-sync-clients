#ifndef SYNCER_H
#define SYNCER_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>

/**
 * Type of the callback function that the user can provide.
 * It is invoked when merging two keys to resolve a conflict or apply custom behavior.
 * 
 * @param key The string key being merged (can be a JSON path or just the property name).
 * @param val1 The JSON representation of the first value (as a string).
 * @param val2 The JSON representation of the second value (as a string).
 * @return A dynamically allocated string containing the merged JSON value, 
 *         or NULL if the default merge behavior should be used.
 *         The caller (syncer core) is responsible for freeing this memory if not NULL.
 */
typedef char* (*syncer_merge_override_cb)(const char* key, const char* val1, const char* val2);

/**
 * Perform a deep merge of two JSON strings.
 * 
 * @param json1 The first JSON string (base).
 * @param json2 The second JSON string (mixin).
 * @param cb    An optional callback for custom merge overrides. Can be NULL.
 * @return A dynamically allocated string containing the merged JSON.
 *         The caller is responsible for freeing this string.
 *         Returns NULL on parsing error or failure.
 */
char* syncer_merge_json(const char* json1, const char* json2, syncer_merge_override_cb cb);

/**
 * Free memory allocated by the syncer library.
 * 
 * @param ptr Pointer to the memory to free.
 */
void syncer_free(void* ptr);

#ifdef __cplusplus
}
#endif

#endif // SYNCER_H
