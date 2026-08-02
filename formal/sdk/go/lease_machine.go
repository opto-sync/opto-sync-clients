package fmadapter

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"sort"
)

type LeaseMachine struct {
	now       *big.Int
	nextFence *big.Int
	leases    map[string]lease
	grants    map[string]grant
	canceled  map[string]bool
	closed    bool
}

type lease struct {
	Owner     string
	Fence     *big.Int
	ExpiresAt *big.Int
}

type grant struct {
	Resource  string
	Owner     string
	Fence     *big.Int
	ExpiresAt *big.Int
}

var leaseSchemaHash = func() string {
	sum := sha256.Sum256([]byte("fmadapter.lease-machine.snapshot.v1"))
	return "sha256:" + hex.EncodeToString(sum[:])
}()

func NewLeaseMachine() *LeaseMachine {
	machine := &LeaseMachine{}
	machine.initialize()
	return machine
}

func (machine *LeaseMachine) initialize() {
	machine.now = big.NewInt(0)
	machine.nextFence = big.NewInt(1)
	machine.leases = map[string]lease{}
	machine.grants = map[string]grant{}
	machine.canceled = map[string]bool{}
	machine.closed = false
}

func (machine *LeaseMachine) Hello(context.Context) Outcome {
	return OK(HelloResult{
		Implementation:           Implementation{Language: "go", Name: "lease-reference", Version: "0.1.0"},
		Capabilities:             []string{"reset", "apply", "observe", "settle", "snapshot", "restore", "fault", "close"},
		CanonicalStateSchemaHash: leaseSchemaHash,
	})
}

func (machine *LeaseMachine) Reset(_ context.Context, initialState any, _ string, logicalTime any) Outcome {
	now, err := parseBigIntValue(logicalTime)
	if err != nil || now.Sign() < 0 {
		return ErrorOutcome("invalid_logical_time", "reset logical time must be a nonnegative #bigint", false, nil)
	}
	machine.initialize()
	machine.now = now
	if initialState != nil {
		object, ok := initialState.(map[string]any)
		if !ok {
			return ErrorOutcome("invalid_initial_state", "initial state must be an object", false, nil)
		}
		if rawFence, exists := object["nextFence"]; exists {
			fence, err := parseBigIntValue(rawFence)
			if err != nil || fence.Sign() <= 0 {
				return ErrorOutcome("invalid_initial_state", "nextFence must be a positive #bigint", false, nil)
			}
			machine.nextFence = fence
		}
	}
	return machine.Observe(context.Background())
}

func (machine *LeaseMachine) Apply(_ context.Context, action string, arguments any, logicalTime any) Outcome {
	if machine.closed {
		return ErrorOutcome("closed", "lease machine is closed", false, nil)
	}
	now, err := parseBigIntValue(logicalTime)
	if err != nil || now.Sign() < 0 {
		return ErrorOutcome("invalid_logical_time", "logical time must be a nonnegative #bigint", false, nil)
	}
	if now.Cmp(machine.now) < 0 {
		return ErrorOutcome("clock_rollback", "logical time cannot move backwards", false, map[string]any{"current": BigInt(machine.now), "received": BigInt(now)})
	}
	machine.now = now
	machine.expire()

	object, ok := arguments.(map[string]any)
	if !ok {
		object = map[string]any{}
	}
	switch action {
	case "acquire":
		return machine.acquire(object)
	case "cancel":
		return machine.cancel(object)
	case "release":
		return machine.release(object)
	case "advance_time":
		return machine.Observe(context.Background())
	default:
		return ErrorOutcome("unknown_action", "unknown lease action", false, map[string]any{"action": action})
	}
}

func (machine *LeaseMachine) Observe(context.Context) Outcome {
	machine.expire()
	resources := make([]string, 0, len(machine.leases))
	for resource := range machine.leases {
		resources = append(resources, resource)
	}
	sort.Strings(resources)
	active := make([]any, 0, len(resources))
	for _, resource := range resources {
		value := machine.leases[resource]
		active = append(active, map[string]any{
			"resource":  resource,
			"owner":     value.Owner,
			"fence":     BigInt(value.Fence),
			"expiresAt": BigInt(value.ExpiresAt),
		})
	}
	return OK(map[string]any{
		"observation": map[string]any{
			"now":       BigInt(machine.now),
			"nextFence": BigInt(machine.nextFence),
			"leases":    active,
		},
	})
}

func (machine *LeaseMachine) Settle(ctx context.Context, _ uint64) Outcome {
	return machine.Observe(ctx)
}

func (machine *LeaseMachine) Snapshot(context.Context) Outcome {
	value := machine.snapshotValue()
	return OK(map[string]any{"schemaHash": leaseSchemaHash, "snapshot": value})
}

func (machine *LeaseMachine) Restore(_ context.Context, snapshot any, schemaHash string) Outcome {
	if schemaHash != leaseSchemaHash {
		return ErrorOutcome("snapshot_schema_mismatch", "snapshot schema hash does not match", false, map[string]any{"expected": leaseSchemaHash, "received": schemaHash})
	}
	if err := machine.restoreValue(snapshot); err != nil {
		return ErrorOutcome("invalid_snapshot", err.Error(), false, nil)
	}
	return machine.Observe(context.Background())
}

func (machine *LeaseMachine) Fault(_ context.Context, fault string, arguments any) Outcome {
	switch fault {
	case "clock_rollback":
		return ErrorOutcome("fault_injected", "clock rollback rejected without changing state", false, map[string]any{"fault": fault, "arguments": arguments})
	case "process_restart":
		snapshot := machine.snapshotValue()
		restarted := NewLeaseMachine()
		if err := restarted.restoreValue(snapshot); err != nil {
			return ErrorOutcome("restart_failed", err.Error(), false, nil)
		}
		*machine = *restarted
		return OK(map[string]any{"restarted": true, "observation": machine.observationValue()})
	default:
		return UnsupportedOutcome("unsupported_fault", "fault is not advertised by the reference machine", map[string]any{"fault": fault})
	}
}

func (machine *LeaseMachine) Close(context.Context) Outcome {
	machine.closed = true
	return OK(map[string]any{"closed": true})
}

func (machine *LeaseMachine) acquire(arguments map[string]any) Outcome {
	resource, owner, request, ttl, err := acquireArguments(arguments)
	if err != nil {
		return ErrorOutcome("invalid_acquire", err.Error(), false, nil)
	}
	if existing, ok := machine.grants[request]; ok {
		return OK(map[string]any{"status": "granted", "idempotent": true, "grant": grantValue(existing)})
	}
	if machine.canceled[request] {
		return ErrorOutcome("canceled", "request was canceled before acquisition", false, map[string]any{"request": request})
	}
	if existing, ok := machine.leases[resource]; ok {
		return ErrorOutcome("busy", "resource is held by another active lease", true, map[string]any{
			"resource": resource, "owner": existing.Owner, "fence": BigInt(existing.Fence), "expiresAt": BigInt(existing.ExpiresAt),
		})
	}
	fence := new(big.Int).Set(machine.nextFence)
	machine.nextFence.Add(machine.nextFence, big.NewInt(1))
	expires := new(big.Int).Add(machine.now, ttl)
	value := lease{Owner: owner, Fence: fence, ExpiresAt: expires}
	machine.leases[resource] = value
	granted := grant{Resource: resource, Owner: owner, Fence: new(big.Int).Set(fence), ExpiresAt: new(big.Int).Set(expires)}
	machine.grants[request] = granted
	return OK(map[string]any{"status": "granted", "idempotent": false, "grant": grantValue(granted)})
}

func (machine *LeaseMachine) cancel(arguments map[string]any) Outcome {
	request, err := requiredString(arguments, "request")
	if err != nil {
		return ErrorOutcome("invalid_cancel", err.Error(), false, nil)
	}
	if granted, ok := machine.grants[request]; ok {
		return OK(map[string]any{"status": "too_late", "grant": grantValue(granted)})
	}
	machine.canceled[request] = true
	return OK(map[string]any{"status": "canceled", "request": request})
}

func (machine *LeaseMachine) release(arguments map[string]any) Outcome {
	resource, err := requiredString(arguments, "resource")
	if err != nil {
		return ErrorOutcome("invalid_release", err.Error(), false, nil)
	}
	owner, err := requiredString(arguments, "owner")
	if err != nil {
		return ErrorOutcome("invalid_release", err.Error(), false, nil)
	}
	fence, err := parseBigIntValue(arguments["fence"])
	if err != nil || fence.Sign() <= 0 {
		return ErrorOutcome("invalid_release", "fence must be a positive #bigint", false, nil)
	}
	current, ok := machine.leases[resource]
	if !ok {
		return OK(map[string]any{"status": "absent"})
	}
	if current.Owner != owner || current.Fence.Cmp(fence) != 0 {
		return ErrorOutcome("stale_fence", "release authority does not match the active lease", false, map[string]any{"activeFence": BigInt(current.Fence)})
	}
	delete(machine.leases, resource)
	return OK(map[string]any{"status": "released", "resource": resource, "fence": BigInt(fence)})
}

func (machine *LeaseMachine) expire() {
	for resource, value := range machine.leases {
		if machine.now.Cmp(value.ExpiresAt) >= 0 {
			delete(machine.leases, resource)
		}
	}
}

func (machine *LeaseMachine) observationValue() any {
	outcome := machine.Observe(context.Background())
	return outcome.Value.(map[string]any)["observation"]
}

func (machine *LeaseMachine) snapshotValue() any {
	grants := make([]any, 0, len(machine.grants))
	grantKeys := make([]string, 0, len(machine.grants))
	for request := range machine.grants {
		grantKeys = append(grantKeys, request)
	}
	sort.Strings(grantKeys)
	for _, request := range grantKeys {
		grants = append(grants, map[string]any{"request": request, "grant": grantValue(machine.grants[request])})
	}
	canceled := make([]any, 0, len(machine.canceled))
	cancelKeys := make([]string, 0, len(machine.canceled))
	for request := range machine.canceled {
		cancelKeys = append(cancelKeys, request)
	}
	sort.Strings(cancelKeys)
	for _, request := range cancelKeys {
		canceled = append(canceled, request)
	}
	return map[string]any{
		"version":     1,
		"now":         BigInt(machine.now),
		"nextFence":   BigInt(machine.nextFence),
		"observation": machine.observationValue(),
		"grants":      grants,
		"canceled":    canceled,
	}
}

func (machine *LeaseMachine) restoreValue(snapshot any) error {
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	var raw struct {
		Version     int               `json:"version"`
		Now         map[string]string `json:"now"`
		NextFence   map[string]string `json:"nextFence"`
		Observation struct {
			Leases []struct {
				Resource  string            `json:"resource"`
				Owner     string            `json:"owner"`
				Fence     map[string]string `json:"fence"`
				ExpiresAt map[string]string `json:"expiresAt"`
			} `json:"leases"`
		} `json:"observation"`
		Grants []struct {
			Request string `json:"request"`
			Grant   struct {
				Resource  string            `json:"resource"`
				Owner     string            `json:"owner"`
				Fence     map[string]string `json:"fence"`
				ExpiresAt map[string]string `json:"expiresAt"`
			} `json:"grant"`
		} `json:"grants"`
		Canceled []string `json:"canceled"`
	}
	if err := json.Unmarshal(encoded, &raw); err != nil {
		return err
	}
	if raw.Version != 1 {
		return errors.New("unsupported snapshot version")
	}
	now, err := parseTaggedMap(raw.Now)
	if err != nil || now.Sign() < 0 {
		return errors.New("invalid snapshot now")
	}
	nextFence, err := parseTaggedMap(raw.NextFence)
	if err != nil || nextFence.Sign() <= 0 {
		return errors.New("invalid snapshot nextFence")
	}
	machine.initialize()
	machine.now = now
	machine.nextFence = nextFence
	for _, item := range raw.Observation.Leases {
		fence, err := parseTaggedMap(item.Fence)
		if err != nil {
			return errors.New("invalid snapshot lease fence")
		}
		expires, err := parseTaggedMap(item.ExpiresAt)
		if err != nil {
			return errors.New("invalid snapshot lease expiry")
		}
		if item.Resource == "" || item.Owner == "" {
			return errors.New("snapshot lease identity is empty")
		}
		machine.leases[item.Resource] = lease{Owner: item.Owner, Fence: fence, ExpiresAt: expires}
	}
	for _, item := range raw.Grants {
		fence, err := parseTaggedMap(item.Grant.Fence)
		if err != nil {
			return errors.New("invalid snapshot grant fence")
		}
		expires, err := parseTaggedMap(item.Grant.ExpiresAt)
		if err != nil {
			return errors.New("invalid snapshot grant expiry")
		}
		if item.Request == "" || item.Grant.Resource == "" || item.Grant.Owner == "" {
			return errors.New("snapshot grant identity is empty")
		}
		machine.grants[item.Request] = grant{Resource: item.Grant.Resource, Owner: item.Grant.Owner, Fence: fence, ExpiresAt: expires}
	}
	for _, request := range raw.Canceled {
		if request == "" {
			return errors.New("snapshot canceled request is empty")
		}
		machine.canceled[request] = true
	}
	machine.expire()
	return nil
}

func acquireArguments(arguments map[string]any) (string, string, string, *big.Int, error) {
	resource, err := requiredString(arguments, "resource")
	if err != nil {
		return "", "", "", nil, err
	}
	owner, err := requiredString(arguments, "owner")
	if err != nil {
		return "", "", "", nil, err
	}
	request, err := requiredString(arguments, "request")
	if err != nil {
		return "", "", "", nil, err
	}
	ttl, err := parseBigIntValue(arguments["ttl"])
	if err != nil || ttl.Sign() <= 0 {
		return "", "", "", nil, errors.New("ttl must be a positive #bigint")
	}
	return resource, owner, request, ttl, nil
}
func requiredString(object map[string]any, key string) (string, error) {
	value, ok := object[key].(string)
	if !ok || value == "" {
		return "", fmt.Errorf("%s must be a nonempty string", key)
	}
	return value, nil
}
func BigInt(value *big.Int) any { return map[string]any{"#bigint": value.String()} }
func parseBigIntValue(value any) (*big.Int, error) {
	object, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("expected #bigint object")
	}
	text, ok := object["#bigint"].(string)
	if !ok || len(object) != 1 {
		return nil, errors.New("expected singleton #bigint object")
	}
	if err := ValidateDecimal(text, true); err != nil {
		return nil, err
	}
	parsed, ok := new(big.Int).SetString(text, 10)
	if !ok {
		return nil, errors.New("invalid #bigint")
	}
	return parsed, nil
}
func parseTaggedMap(value map[string]string) (*big.Int, error) {
	text, ok := value["#bigint"]
	if !ok || len(value) != 1 {
		return nil, errors.New("expected singleton #bigint")
	}
	return parseBigIntValue(map[string]any{"#bigint": text})
}
func grantValue(value grant) any {
	return map[string]any{"resource": value.Resource, "owner": value.Owner, "fence": BigInt(value.Fence), "expiresAt": BigInt(value.ExpiresAt)}
}
