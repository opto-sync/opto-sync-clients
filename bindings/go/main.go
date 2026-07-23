package main

/*
#cgo CFLAGS: -I../../core/include
#cgo LDFLAGS: -L../../core/build -lsyncer
#include <stdlib.h>
#include "syncer.h"

// Forward declaration of the gateway function to Go
extern char* goMergeOverride(char* key, char* v1, char* v2);

// C wrapper that calls the Go gateway
static inline char* c_override_cb(const char* key, const char* v1, const char* v2) {
    return goMergeOverride((char*)key, (char*)v1, (char*)v2);
}

static inline syncer_merge_override_cb get_cb() {
    return c_override_cb;
}
*/
import "C"
import (
	"fmt"
	"unsafe"
)

//export goMergeOverride
func goMergeOverride(key *C.char, v1 *C.char, v2 *C.char) *C.char {
	gokey := C.GoString(key)
	if gokey == "override_me" {
		// Custom merge logic executed in Go
		return C.CString(`{"custom": "merged in Go!"}`)
	}
	return nil // fallback to default C deep-merge logic
}

func MergeJson(j1, j2 string) string {
	cj1 := C.CString(j1)
	cj2 := C.CString(j2)
	defer C.free(unsafe.Pointer(cj1))
	defer C.free(unsafe.Pointer(cj2))

	// Call the C core, passing the C wrapper callback
	resPtr := C.syncer_merge_json(cj1, cj2, C.get_cb())
	if resPtr == nil {
		return ""
	}
	res := C.GoString(resPtr)
	C.syncer_free(unsafe.Pointer(resPtr))
	return res
}

func main() {
	j1 := `{"a": 1, "b": {"c": 2}, "override_me": "no"}`
	j2 := `{"b": {"d": 3}, "e": 4, "override_me": "yes"}`
	
	fmt.Println("Testing Go CGO Binding to syncer.c:")
	fmt.Println("Merged:", MergeJson(j1, j2))
}
