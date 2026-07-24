#include "syncer.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static char* g_last_path = NULL;

static char* capture_cb(const char* path, const char* v1, const char* v2) {
    (void)v1; (void)v2;
    free(g_last_path);
    g_last_path = strdup(path);
    return NULL;
}

int main(void) {
    setbuf(stdout, NULL);

    printf("=== Quick multi-test ===\n");

    printf("[1] Flat merge... ");
    {
        char* r = syncer_merge_json("{\"a\":1,\"b\":2}", "{\"b\":3,\"c\":4}", NULL);
        printf("%s\n", r ? r : "NULL");
        syncer_free(r);
    }

    printf("[2] Deep nested (10 levels)... ");
    {
        const char* j1 = "{\"l1\":{\"l2\":{\"l3\":{\"l4\":{\"l5\":{\"l6\":{\"l7\":{\"l8\":{\"l9\":{\"l10\":{\"deep\":\"v1\"}}}}}}}}}}}";
        const char* j2 = "{\"l1\":{\"l2\":{\"l3\":{\"l4\":{\"l5\":{\"l6\":{\"l7\":{\"l8\":{\"l9\":{\"l10\":{\"deep\":\"v2\",\"new\":true}}}}}}}}}}}";
        char* r = syncer_merge_json(j1, j2, NULL);
        printf("%s OK\n", r ? "PASS" : "FAIL");
        syncer_free(r);
    }

    printf("[3] Array append... ");
    {
        syncer_merge_options_t opts = syncer_default_options();
        opts.array_strategy = SYNCER_ARRAY_APPEND;
        char* r = syncer_merge_json_ex("{\"arr\":[1,2,3]}", "{\"arr\":[4,5]}", &opts);
        printf("%s => %s\n", r ? "PASS" : "FAIL", r ? r : "");
        syncer_free(r);
    }

    printf("[4] Array union... ");
    {
        syncer_merge_options_t opts = syncer_default_options();
        opts.array_strategy = SYNCER_ARRAY_UNION;
        char* r = syncer_merge_json_ex("{\"arr\":[1,2,3]}", "{\"arr\":[2,3,4]}", &opts);
        printf("%s => %s\n", r ? "PASS" : "FAIL", r ? r : "");
        syncer_free(r);
    }

    printf("[5] Path callback... ");
    {
        syncer_merge_options_t opts = syncer_default_options();
        opts.override_cb = capture_cb;
        char* r = syncer_merge_json_ex("{\"user\":{\"name\":\"old\"}}", "{\"user\":{\"name\":\"new\"}}", &opts);
        printf("path=%s result=%s\n", g_last_path ? g_last_path : "(none)", r ? "OK" : "FAIL");
        syncer_free(r);
        free(g_last_path); g_last_path = NULL;
    }

    printf("[6] Extreme depth (100 levels)... ");
    {
        size_t depth = 100;
        size_t bufsz = depth * 6 + 256;
        char* j1 = (char*)malloc(bufsz);
        char* j2 = (char*)malloc(bufsz);
        size_t p1 = 0, p2 = 0;
        for (size_t i = 0; i < depth; i++) {
            p1 += (size_t)sprintf(j1 + p1, "{\"k\":");
            p2 += (size_t)sprintf(j2 + p2, "{\"k\":");
        }
        p1 += (size_t)sprintf(j1 + p1, "{\"val\":\"one\"}");
        p2 += (size_t)sprintf(j2 + p2, "{\"val\":\"two\"}");
        for (size_t i = 0; i < depth; i++) { j1[p1++] = '}'; j2[p2++] = '}'; }
        j1[p1] = '\0'; j2[p2] = '\0';

        char* r = syncer_merge_json(j1, j2, NULL);
        int ok = r && strstr(r, "\"val\":\"two\"");
        printf("%s\n", ok ? "PASS" : "FAIL");
        free(j1); free(j2); syncer_free(r);
    }

    printf("[7] Mixed types... ");
    {
        char* r = syncer_merge_json("{\"data\":{\"nested\":true}}", "{\"data\":\"replaced\"}", NULL);
        int ok = r && strstr(r, "\"data\":\"replaced\"");
        printf("%s\n", ok ? "PASS" : "FAIL");
        syncer_free(r);
    }

    printf("[8] Array merge by index... ");
    {
        syncer_merge_options_t opts = syncer_default_options();
        opts.array_strategy = SYNCER_ARRAY_MERGE_BY_INDEX;
        char* r = syncer_merge_json_ex(
            "{\"arr\":[{\"name\":\"alice\"},{\"name\":\"bob\"}]}",
            "{\"arr\":[{\"age\":30},{\"age\":25}]}",
            &opts);
        int ok = r && strstr(r, "\"name\":\"alice\"") && strstr(r, "\"age\":30");
        printf("%s => %s\n", ok ? "PASS" : "FAIL", r ? r : "");
        syncer_free(r);
    }

    printf("=== All quick tests done ===\n");
    return 0;
}
