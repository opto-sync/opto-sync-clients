package main

import (
	"context"
	"fmt"
	"os"

	fmadapter "github.com/ORESoftware/formal-methods.rs/sdk/go"
)

func main() {
	if err := fmadapter.Serve(context.Background(), os.Stdin, os.Stdout, fmadapter.NewLeaseMachine()); err != nil {
		fmt.Fprintf(os.Stderr, "fm-go-reference: %v\n", err)
		os.Exit(2)
	}
}
