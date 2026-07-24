CC      ?= cc
CFLAGS  := -Wall -Wextra -O2 -Iinclude -Isrc
LDFLAGS :=

SRCS_CORE := src/syncer.c src/yyjson.c
SRCS_TEST := test/test_syncer.c
BIN_TEST  := test/test_syncer

.PHONY: all test clean

all: test

test: $(BIN_TEST)
	@echo ""
	@echo "Running tests..."
	@./$(BIN_TEST)

$(BIN_TEST): $(SRCS_TEST) $(SRCS_CORE)
	@mkdir -p test
	$(CC) $(CFLAGS) -o $@ $(SRCS_TEST) $(SRCS_CORE) $(LDFLAGS)

clean:
	rm -f $(BIN_TEST)
