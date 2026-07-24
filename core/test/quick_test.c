#include "syncer.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
    printf("Test 1: flat merge\n");
    const char* j1 = "{\"a\":1,\"b\":2}";
    const char* j2 = "{\"b\":3,\"c\":4}";
    char* result = syncer_merge_json(j1, j2, NULL);
    if (result) {
        printf("Result: %s\n", result);
        syncer_free(result);
    } else {
        printf("FAILED: NULL result\n");
    }
    printf("Done\n");
    return 0;
}
