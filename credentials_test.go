package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/egoist/mygo"
)

type fakeSecretStore struct {
	items       map[string][]byte
	getErr      error
	setErr      error
	getCalls    int
	setCalls    int
	deleteCalls int
}

func newFakeSecretStore() *fakeSecretStore {
	return &fakeSecretStore{
		items: make(map[string][]byte),
	}
}

func (f *fakeSecretStore) Get(key string) ([]byte, error) {
	f.getCalls++
	if f.getErr != nil {
		return nil, f.getErr
	}
	v, ok := f.items[key]
	if !ok {
		return nil, mygo.ErrSecretNotFound
	}
	cp := make([]byte, len(v))
	copy(cp, v)
	return cp, nil
}

func (f *fakeSecretStore) Set(key string, value []byte) error {
	f.setCalls++
	if f.setErr != nil {
		return f.setErr
	}
	cp := make([]byte, len(value))
	copy(cp, value)
	f.items[key] = cp
	return nil
}

func (f *fakeSecretStore) Delete(key string) error {
	f.deleteCalls++
	delete(f.items, key)
	return nil
}

func newTestRedisService(dir string, secrets secretStore) *RedisService {
	svc := NewRedisService()
	svc.configDirFn = func() (string, error) { return dir, nil }
	svc.secrets = secrets
	return svc
}

func TestDefaultLocalCredentialStorageZeroKeychainCalls(t *testing.T) {
	dir := t.TempDir()
	secrets := newFakeSecretStore()
	svc := newTestRedisService(dir, secrets)

	status, err := svc.GetCredentialStorage()
	if err != nil {
		t.Fatalf("GetCredentialStorage: %v", err)
	}
	if status.Mode != CredentialStorageLocal || status.KeychainPending != 0 {
		t.Fatalf("unexpected initial status: %+v", status)
	}

	const rawPassword = "super-secret-redis-pw"
	err = svc.SaveConnection(Connection{
		ID:   "local-1",
		Name: "Local Primary",
		Host: "127.0.0.1",
		Port: 6379,
	}, rawPassword)
	if err != nil {
		t.Fatalf("SaveConnection: %v", err)
	}

	if secrets.getCalls != 0 || secrets.setCalls != 0 || secrets.deleteCalls != 0 {
		t.Fatalf("expected zero keychain calls in local mode, got get=%d set=%d delete=%d", secrets.getCalls, secrets.setCalls, secrets.deleteCalls)
	}

	keyInfo, err := os.Stat(filepath.Join(dir, "credential.key"))
	if err != nil {
		t.Fatalf("stat credential.key: %v", err)
	}
	if got := keyInfo.Mode().Perm(); got != 0o600 {
		t.Fatalf("credential.key perm = %o, want 0600", got)
	}

	connPath := filepath.Join(dir, "connections.json")
	connInfo, err := os.Stat(connPath)
	if err != nil {
		t.Fatalf("stat connections.json: %v", err)
	}
	if got := connInfo.Mode().Perm(); got != 0o600 {
		t.Fatalf("connections.json perm = %o, want 0600", got)
	}

	rawJSON, err := os.ReadFile(connPath)
	if err != nil {
		t.Fatalf("read connections.json: %v", err)
	}
	if strings.Contains(string(rawJSON), rawPassword) {
		t.Fatalf("connections.json leaked plaintext password: %s", string(rawJSON))
	}
	if !strings.Contains(string(rawJSON), `"encryptedPassword": "v1:`) {
		t.Fatalf("connections.json missing v1 encryptedPassword: %s", string(rawJSON))
	}

	// Simulate app restart / update: new service instance reads encrypted password without touching keychain.
	restarted := newTestRedisService(dir, secrets)
	if _, err := restarted.ListConnections(); err != nil {
		t.Fatalf("ListConnections after restart: %v", err)
	}
	gotPW, err := restarted.resolvePassword("local-1")
	if err != nil {
		t.Fatalf("resolvePassword after restart: %v", err)
	}
	if gotPW != rawPassword {
		t.Fatalf("resolvePassword = %q, want %q", gotPW, rawPassword)
	}
	if err := restarted.DeleteConnection("local-1"); err != nil {
		t.Fatalf("DeleteConnection: %v", err)
	}
	if secrets.getCalls != 0 || secrets.setCalls != 0 || secrets.deleteCalls != 0 {
		t.Fatalf("expected zero keychain calls across save/restart/delete, got get=%d set=%d delete=%d", secrets.getCalls, secrets.setCalls, secrets.deleteCalls)
	}
}

func TestEditConnectionPreservesEncryptedPasswordWithoutKeychain(t *testing.T) {
	dir := t.TempDir()
	secrets := newFakeSecretStore()
	svc := newTestRedisService(dir, secrets)

	if err := svc.SaveConnection(Connection{
		ID:   "edit-1",
		Name: "Before Edit",
		Host: "127.0.0.1",
		Port: 6379,
	}, "keep-this-secret"); err != nil {
		t.Fatalf("initial SaveConnection: %v", err)
	}

	// Editing host/name with empty password keeps existing encrypted credential.
	if err := svc.SaveConnection(Connection{
		ID:   "edit-1",
		Name: "After Edit",
		Host: "127.0.0.1",
		Port: 6380,
	}, ""); err != nil {
		t.Fatalf("update SaveConnection: %v", err)
	}

	restarted := newTestRedisService(dir, secrets)
	if _, err := restarted.ListConnections(); err != nil {
		t.Fatalf("ListConnections: %v", err)
	}
	pw, err := restarted.resolvePassword("edit-1")
	if err != nil {
		t.Fatalf("resolvePassword: %v", err)
	}
	if pw != "keep-this-secret" {
		t.Fatalf("password = %q, want %q", pw, "keep-this-secret")
	}
	if secrets.getCalls != 0 || secrets.setCalls != 0 || secrets.deleteCalls != 0 {
		t.Fatalf("unexpected keychain calls: %+v", secrets)
	}
}

func TestLegacyPlaintextFallbackUpgradesToEncryptedOnLoad(t *testing.T) {
	dir := t.TempDir()
	secrets := newFakeSecretStore()

	legacy := `[{"id":"plain-1","name":"Legacy","host":"127.0.0.1","port":6379,"password":"legacy-plain-pw"}]`
	connPath := filepath.Join(dir, "connections.json")
	if err := os.WriteFile(connPath, []byte(legacy), 0o600); err != nil {
		t.Fatalf("seed legacy connections.json: %v", err)
	}

	svc := newTestRedisService(dir, secrets)
	if _, err := svc.ListConnections(); err != nil {
		t.Fatalf("ListConnections: %v", err)
	}

	rawAfter, err := os.ReadFile(connPath)
	if err != nil {
		t.Fatalf("read upgraded connections.json: %v", err)
	}
	if strings.Contains(string(rawAfter), "legacy-plain-pw") {
		t.Fatalf("expected plaintext password to be scrubbed on load, got: %s", string(rawAfter))
	}

	restarted := newTestRedisService(dir, secrets)
	if _, err := restarted.ListConnections(); err != nil {
		t.Fatalf("ListConnections after restart: %v", err)
	}
	pw, err := restarted.resolvePassword("plain-1")
	if err != nil {
		t.Fatalf("resolvePassword: %v", err)
	}
	if pw != "legacy-plain-pw" {
		t.Fatalf("pw = %q, want %q", pw, "legacy-plain-pw")
	}
	if secrets.getCalls != 0 {
		t.Fatalf("expected 0 keychain calls, got %d", secrets.getCalls)
	}
}

func TestLegacyKeychainConnectionLazyMigrationAndPasswordlessUpgrade(t *testing.T) {
	dir := t.TempDir()
	secrets := newFakeSecretStore()
	secrets.items[passwordSecretKey("legacy-kc")] = []byte("migrated-from-keychain")

	legacy := `[
		{"id":"legacy-kc","name":"Prod","host":"10.0.0.1","port":6379},
		{"id":"legacy-open","name":"Local","host":"127.0.0.1","port":6379}
	]`
	if err := os.WriteFile(filepath.Join(dir, "connections.json"), []byte(legacy), 0o600); err != nil {
		t.Fatalf("seed connections.json: %v", err)
	}

	svc := newTestRedisService(dir, secrets)
	if _, err := svc.ListConnections(); err != nil {
		t.Fatalf("ListConnections: %v", err)
	}

	pw, err := svc.resolvePassword("legacy-kc")
	if err != nil {
		t.Fatalf("resolvePassword(legacy-kc): %v", err)
	}
	if pw != "migrated-from-keychain" {
		t.Fatalf("pw = %q, want %q", pw, "migrated-from-keychain")
	}
	if _, stillInKeychain := secrets.items[passwordSecretKey("legacy-kc")]; stillInKeychain {
		t.Fatalf("expected legacy keychain entry to be deleted after local migration")
	}

	openPW, err := svc.resolvePassword("legacy-open")
	if err != nil {
		t.Fatalf("resolvePassword(legacy-open): %v", err)
	}
	if openPW != "" {
		t.Fatalf("openPW = %q, want empty", openPW)
	}

	// Simulate subsequent app update: a brand-new binary instance must make 0 keychain calls.
	secretsAfterUpdate := newFakeSecretStore()
	secretsAfterUpdate.getErr = errors.New("keychain should not be queried after migration")
	updatedApp := newTestRedisService(dir, secretsAfterUpdate)
	if _, err := updatedApp.ListConnections(); err != nil {
		t.Fatalf("updatedApp.ListConnections: %v", err)
	}
	gotMigrated, err := updatedApp.resolvePassword("legacy-kc")
	if err != nil || gotMigrated != "migrated-from-keychain" {
		t.Fatalf("updatedApp.resolvePassword(legacy-kc) = (%q, %v)", gotMigrated, err)
	}
	gotOpen, err := updatedApp.resolvePassword("legacy-open")
	if err != nil || gotOpen != "" {
		t.Fatalf("updatedApp.resolvePassword(legacy-open) = (%q, %v)", gotOpen, err)
	}
	if secretsAfterUpdate.getCalls != 0 {
		t.Fatalf("expected 0 keychain calls after update, got %d", secretsAfterUpdate.getCalls)
	}
}

func TestDeniedKeychainPromptReportsPendingAndResaveMigrates(t *testing.T) {
	dir := t.TempDir()
	secrets := newFakeSecretStore()
	secrets.items[passwordSecretKey("legacy-denied")] = []byte("old-secret")
	secrets.getErr = errors.New("user canceled authorization")

	legacy := `[{"id":"legacy-denied","name":"Staging","host":"10.0.0.2","port":6379}]`
	if err := os.WriteFile(filepath.Join(dir, "connections.json"), []byte(legacy), 0o600); err != nil {
		t.Fatalf("seed connections.json: %v", err)
	}

	svc := newTestRedisService(dir, secrets)
	if _, err := svc.ListConnections(); err != nil {
		t.Fatalf("ListConnections: %v", err)
	}
	if _, err := svc.resolvePassword("legacy-denied"); err == nil {
		t.Fatalf("expected error when keychain prompt is denied")
	}

	status, err := svc.GetCredentialStorage()
	if err != nil {
		t.Fatalf("GetCredentialStorage: %v", err)
	}
	if status.Mode != CredentialStorageLocal || status.KeychainPending != 1 {
		t.Fatalf("status = %+v, want local with KeychainPending=1", status)
	}

	// Re-saving password in Edit Connection bypasses keychain read and completes migration.
	if err := svc.SaveConnection(Connection{
		ID:   "legacy-denied",
		Name: "Staging",
		Host: "10.0.0.2",
		Port: 6379,
	}, "reentered-secret"); err != nil {
		t.Fatalf("SaveConnection: %v", err)
	}

	statusAfter, err := svc.GetCredentialStorage()
	if err != nil {
		t.Fatalf("GetCredentialStorage after resave: %v", err)
	}
	if statusAfter.KeychainPending != 0 {
		t.Fatalf("KeychainPending = %d, want 0", statusAfter.KeychainPending)
	}
	if _, exists := secrets.items[passwordSecretKey("legacy-denied")]; exists {
		t.Fatalf("expected stale keychain secret to be cleaned up on resave")
	}
}

func TestSwitchCredentialStorageBothDirectionsAndFailureSafety(t *testing.T) {
	dir := t.TempDir()
	secrets := newFakeSecretStore()
	svc := newTestRedisService(dir, secrets)

	if err := svc.SaveConnection(Connection{ID: "c1", Name: "WithPW", Host: "127.0.0.1", Port: 6379}, "pw-one"); err != nil {
		t.Fatalf("save c1: %v", err)
	}
	if err := svc.SaveConnection(Connection{ID: "c2", Name: "NoPW", Host: "127.0.0.1", Port: 6380}, ""); err != nil {
		t.Fatalf("save c2: %v", err)
	}

	// Simulate keychain write failure first: must keep local mode and preserve encrypted password.
	secrets.setErr = errors.ErrUnsupported
	if _, err := svc.SetCredentialStorage(CredentialStorageKeychain); err == nil {
		t.Fatalf("expected error when keychain Set fails")
	}
	secrets.setErr = nil

	statusStillLocal, _ := svc.GetCredentialStorage()
	if statusStillLocal.Mode != CredentialStorageLocal {
		t.Fatalf("mode changed despite failure: %+v", statusStillLocal)
	}

	// Switch local -> keychain.
	statusKC, err := svc.SetCredentialStorage(CredentialStorageKeychain)
	if err != nil {
		t.Fatalf("SetCredentialStorage(keychain): %v", err)
	}
	if statusKC.Mode != CredentialStorageKeychain || statusKC.KeychainPending != 0 {
		t.Fatalf("unexpected keychain status: %+v", statusKC)
	}
	if got := string(secrets.items[passwordSecretKey("c1")]); got != "pw-one" {
		t.Fatalf("keychain item for c1 = %q, want %q", got, "pw-one")
	}

	var storedRecords []connectionRecord
	rawKC, err := os.ReadFile(filepath.Join(dir, "connections.json"))
	if err != nil {
		t.Fatalf("read connections.json: %v", err)
	}
	if err := json.Unmarshal(rawKC, &storedRecords); err != nil {
		t.Fatalf("unmarshal connections.json: %v", err)
	}
	for _, r := range storedRecords {
		if r.EncryptedPassword != "" || r.Password != "" {
			t.Fatalf("expected no local password fields in keychain mode, got record %+v", r)
		}
	}

	// Restart in keychain mode, then switch keychain -> local.
	restartedKC := newTestRedisService(dir, secrets)
	stReloaded, err := restartedKC.GetCredentialStorage()
	if err != nil || stReloaded.Mode != CredentialStorageKeychain {
		t.Fatalf("reloaded mode = (%+v, %v), want keychain", stReloaded, err)
	}

	stLocal, err := restartedKC.SetCredentialStorage(CredentialStorageLocal)
	if err != nil {
		t.Fatalf("SetCredentialStorage(local): %v", err)
	}
	if stLocal.Mode != CredentialStorageLocal || stLocal.KeychainPending != 0 {
		t.Fatalf("unexpected local status: %+v", stLocal)
	}
	if _, exists := secrets.items[passwordSecretKey("c1")]; exists {
		t.Fatalf("expected keychain item for c1 to be deleted after switching to local")
	}

	// Final restart in local mode: 0 keychain calls needed.
	noKeychain := newFakeSecretStore()
	noKeychain.getErr = errors.New("unexpected keychain access")
	finalSvc := newTestRedisService(dir, noKeychain)
	if _, err := finalSvc.ListConnections(); err != nil {
		t.Fatalf("finalSvc.ListConnections: %v", err)
	}
	pw1, err := finalSvc.resolvePassword("c1")
	if err != nil || pw1 != "pw-one" {
		t.Fatalf("finalSvc.resolvePassword(c1) = (%q, %v)", pw1, err)
	}
	pw2, err := finalSvc.resolvePassword("c2")
	if err != nil || pw2 != "" {
		t.Fatalf("finalSvc.resolvePassword(c2) = (%q, %v)", pw2, err)
	}
}
