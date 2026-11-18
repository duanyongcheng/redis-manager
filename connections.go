package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// ListConnections returns saved connections without credentials.
func (s *RedisService) ListConnections() ([]Connection, error) {
	if err := s.ensureLoaded(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	items := make([]Connection, 0, len(s.records))
	for _, record := range s.records {
		items = append(items, record.Connection)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Group == items[j].Group {
			return items[i].Name < items[j].Name
		}
		return items[i].Group < items[j].Group
	})
	return items, nil
}

// SaveConnection writes a connection definition and stores its password in the
// configured credential backend (local AES-256-GCM file or OS keychain).
func (s *RedisService) SaveConnection(input Connection, password string) error {
	input = normalizeConnection(input)
	if input.Name == "" {
		input.Name = input.Host
	}
	if stripHostBrackets(input.Host) == "" {
		return errors.New("redis host is required")
	}
	if err := s.ensureLoaded(); err != nil {
		return err
	}

	s.mu.Lock()
	mode := s.credentialStorage
	existing, hasExisting := s.records[input.ID]
	s.mu.Unlock()

	var deleteKeychainAfterSave bool
	var storedInKeychain bool
	if password != "" && mode == CredentialStorageKeychain {
		if err := s.secretBackend().Set(passwordSecretKey(input.ID), []byte(password)); err == nil {
			storedInKeychain = true
		}
	}

	s.mu.Lock()
	var record connectionRecord
	record.Connection = input

	switch {
	case password != "":
		s.passwords[input.ID] = password
		if storedInKeychain {
			record.CredentialStore = credentialStoreKeychain
		} else {
			enc, err := s.encryptPasswordLocked(password)
			if err != nil {
				s.mu.Unlock()
				return err
			}
			record.EncryptedPassword = enc
			record.CredentialStore = credentialStoreLocal
			if hasExisting && (existing.CredentialStore == credentialStoreKeychain || existing.CredentialStore == "") {
				deleteKeychainAfterSave = true
			}
		}
	case hasExisting:
		record.Password = existing.Password
		record.EncryptedPassword = existing.EncryptedPassword
		record.CredentialStore = existing.CredentialStore
		if s.credentialStorage == CredentialStorageLocal && record.Password != "" {
			enc, err := s.encryptPasswordLocked(record.Password)
			if err != nil {
				s.mu.Unlock()
				return err
			}
			s.passwords[input.ID] = record.Password
			record.EncryptedPassword = enc
			record.Password = ""
			record.CredentialStore = credentialStoreLocal
		}
	default:
		s.passwords[input.ID] = ""
		record.CredentialStore = credentialStoreNone
	}

	s.records[input.ID] = record
	s.closeClientsForLocked(input.ID)
	err := s.saveLocked()
	s.mu.Unlock()

	if err == nil && deleteKeychainAfterSave {
		_ = s.secretBackend().Delete(passwordSecretKey(input.ID))
	}
	return err
}

// DeleteConnection removes a saved connection and closes its cached clients.
func (s *RedisService) DeleteConnection(id string) error {
	if err := s.ensureLoaded(); err != nil {
		return err
	}
	s.mu.Lock()
	existing, hasExisting := s.records[id]
	s.closeClientsForLocked(id)
	delete(s.passwords, id)
	delete(s.records, id)
	err := s.saveLocked()
	s.mu.Unlock()

	if hasExisting && (existing.CredentialStore == credentialStoreKeychain || existing.CredentialStore == "") {
		_ = s.secretBackend().Delete(passwordSecretKey(id))
	}
	return err
}

// TestConnection pings a Redis server and returns a small INFO summary.
func (s *RedisService) TestConnection(input Connection, password string) (ConnectionTest, error) {
	input = normalizeConnection(input)
	if stripHostBrackets(input.Host) == "" {
		return ConnectionTest{Status: "error", Message: "redis host is required"}, errors.New("redis host is required")
	}
	client, err := newRedisClient(connectionRecord{Connection: input, Password: password})
	if err != nil {
		return ConnectionTest{Status: "error", Message: err.Error()}, err
	}
	defer client.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	start := time.Now()
	if err := client.Ping(ctx).Err(); err != nil {
		return ConnectionTest{Status: "error", Message: err.Error()}, err
	}
	result := ConnectionTest{
		Status:    "ok",
		Message:   "连接成功",
		LatencyMS: float64(time.Since(start).Microseconds()) / 1000,
		DBCount:   0,
	}
	info, infoErr := client.Info(ctx, "server", "keyspace").Result()
	if infoErr == nil {
		fields := parseInfo(info)
		result.Version = fields["redis_version"]
		result.Mode = fields["redis_mode"]
		if result.Mode == "" {
			result.Mode = input.Mode
		}
		if n, parseErr := strconv.Atoi(fields["databases"]); parseErr == nil && n > 0 {
			result.DBCount = n
		} else {
			for key := range fields {
				if strings.HasPrefix(key, "db") {
					if _, dbErr := strconv.Atoi(strings.TrimPrefix(key, "db")); dbErr == nil {
						result.DBCount++
					}
				}
			}
		}
	}
	if result.DBCount == 0 {
		if cfg, configErr := client.ConfigGet(ctx, "databases").Result(); configErr == nil {
			if rawDBs, ok := cfg["databases"]; ok {
				result.DBCount = parseInt(rawDBs)
			}
		}
	}
	if result.DBCount == 0 && strings.EqualFold(result.Mode, "cluster") {
		result.DBCount = 1
	}
	return result, nil
}

// CheckConnection tests a saved connection using its stored credential.
func (s *RedisService) CheckConnection(connID string) (ConnectionTest, error) {
	if err := s.ensureLoaded(); err != nil {
		return ConnectionTest{Status: "error", Message: err.Error()}, err
	}
	s.mu.Lock()
	record, ok := s.records[connID]
	s.mu.Unlock()
	if !ok {
		err := fmt.Errorf("connection %q not found", connID)
		return ConnectionTest{Status: "error", Message: err.Error()}, err
	}
	password, err := s.resolvePassword(connID)
	if err != nil {
		return ConnectionTest{Status: "error", Message: err.Error()}, err
	}
	return s.TestConnection(record.Connection, password)
}

func (s *RedisService) isConnectionReadOnly(connID string) (bool, error) {
	if err := s.ensureLoaded(); err != nil {
		return false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.records[connID]
	if !ok {
		return false, fmt.Errorf("connection %q not found", connID)
	}
	return record.ReadOnly, nil
}

func normalizeConnection(input Connection) Connection {
	if input.ID == "" {
		input.ID = fmt.Sprintf("conn-%d", time.Now().UnixNano())
	}
	if input.Port == 0 {
		input.Port = defaultPort
	}
	if input.DB < 0 {
		input.DB = defaultDB
	}
	if input.Mode == "" {
		input.Mode = "standalone"
	}
	if input.Group == "" {
		input.Group = "Local"
	}
	return input
}

func (s *RedisService) ensureMapsLocked() {
	if s.credentialStorage == "" {
		s.credentialStorage = CredentialStorageLocal
	}
	if s.records == nil {
		s.records = make(map[string]connectionRecord)
	}
	if s.passwords == nil {
		s.passwords = make(map[string]string)
	}
	if s.clients == nil {
		s.clients = make(map[clientKey]redis.UniversalClient)
	}
	if s.clusterScans == nil {
		s.clusterScans = make(map[uint64]clusterScanCursor)
	}
}

func (s *RedisService) ensureLoaded() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureMapsLocked()
	if s.loaded {
		return nil
	}
	if err := s.loadPreferencesLocked(); err != nil {
		return err
	}
	path, err := s.connectionsFilePath()
	if err != nil {
		return err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		s.loaded = true
		return nil
	}
	if err != nil {
		return err
	}
	var records []connectionRecord
	if err := json.Unmarshal(data, &records); err != nil {
		return fmt.Errorf("decode connections: %w", err)
	}
	upgraded := false
	for _, record := range records {
		record.Connection = normalizeConnection(record.Connection)
		if record.Password != "" {
			s.passwords[record.ID] = record.Password
			if s.credentialStorage == CredentialStorageLocal {
				if enc, encErr := s.encryptPasswordLocked(record.Password); encErr == nil {
					record.EncryptedPassword = enc
					record.Password = ""
					record.CredentialStore = credentialStoreLocal
					upgraded = true
				}
			}
		} else if record.EncryptedPassword != "" && record.CredentialStore == "" {
			record.CredentialStore = credentialStoreLocal
			upgraded = true
		}
		s.records[record.ID] = record
	}
	s.loaded = true
	if upgraded {
		_ = s.saveLocked()
	}
	return nil
}

func (s *RedisService) saveLocked() error {
	path, err := s.connectionsFilePath()
	if err != nil {
		return err
	}
	records := make([]connectionRecord, 0, len(s.records))
	for _, record := range s.records {
		records = append(records, record)
	}
	sort.Slice(records, func(i, j int) bool { return records[i].Name < records[j].Name })
	data, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomicFile(path, data, 0o600)
}

func (s *RedisService) connectionsFilePath() (string, error) {
	dir, err := s.configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "connections.json"), nil
}

func passwordSecretKey(id string) string {
	return "connection/" + id
}

func resolveTargetDB(record connectionRecord, requestedDB int) int {
	if strings.EqualFold(strings.TrimSpace(record.Mode), "cluster") {
		return 0
	}
	if requestedDB < 0 {
		if record.DB < 0 {
			return defaultDB
		}
		return record.DB
	}
	return requestedDB
}

func (s *RedisService) touchClientOrderLocked(ck clientKey) {
	for i, existing := range s.clientOrder {
		if existing == ck {
			s.clientOrder = append(s.clientOrder[:i], s.clientOrder[i+1:]...)
			break
		}
	}
	s.clientOrder = append(s.clientOrder, ck)
}

func (s *RedisService) evictOverflowClientsLocked(connID string) []redis.UniversalClient {
	count := 0
	for _, ck := range s.clientOrder {
		if ck.id == connID {
			count++
		}
	}
	var evicted []redis.UniversalClient
	for count >= maxCachedDBClientsPerConn {
		evictIdx := -1
		for i, ck := range s.clientOrder {
			if ck.id == connID {
				evictIdx = i
				break
			}
		}
		if evictIdx < 0 {
			break
		}
		victimKey := s.clientOrder[evictIdx]
		s.clientOrder = append(s.clientOrder[:evictIdx], s.clientOrder[evictIdx+1:]...)
		if victimClient, ok := s.clients[victimKey]; ok {
			evicted = append(evicted, victimClient)
			delete(s.clients, victimKey)
		}
		count--
	}
	return evicted
}

func (s *RedisService) closeClientsForLocked(id string) {
	for ck, client := range s.clients {
		if ck.id == id {
			_ = client.Close()
			delete(s.clients, ck)
		}
	}
	filteredOrder := s.clientOrder[:0]
	for _, ck := range s.clientOrder {
		if ck.id != id {
			filteredOrder = append(filteredOrder, ck)
		}
	}
	s.clientOrder = filteredOrder

	for token, cursor := range s.clusterScans {
		if cursor.connID == id {
			delete(s.clusterScans, token)
		}
	}
	filteredTokens := s.scanTokenOrder[:0]
	for _, token := range s.scanTokenOrder {
		if _, exists := s.clusterScans[token]; exists {
			filteredTokens = append(filteredTokens, token)
		}
	}
	s.scanTokenOrder = filteredTokens
}

func (s *RedisService) clientFor(id string, db int) (redis.UniversalClient, error) {
	if err := s.ensureLoaded(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.ensureMapsLocked()
	record, ok := s.records[id]
	if !ok {
		s.mu.Unlock()
		return nil, fmt.Errorf("connection %q not found", id)
	}
	targetDB := resolveTargetDB(record, db)
	ck := clientKey{id: id, db: targetDB}
	if client, exists := s.clients[ck]; exists {
		s.touchClientOrderLocked(ck)
		s.mu.Unlock()
		return client, nil
	}
	s.mu.Unlock()

	password, err := s.resolvePassword(id)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	record, ok = s.records[id]
	if !ok {
		s.mu.Unlock()
		return nil, fmt.Errorf("connection %q not found", id)
	}
	targetDB = resolveTargetDB(record, db)
	ck = clientKey{id: id, db: targetDB}
	if client, exists := s.clients[ck]; exists {
		s.touchClientOrderLocked(ck)
		s.mu.Unlock()
		return client, nil
	}
	record.Password = password
	record.DB = targetDB
	client, err := newRedisClient(record)
	if err != nil {
		s.mu.Unlock()
		return nil, err
	}
	evicted := s.evictOverflowClientsLocked(id)
	s.clients[ck] = client
	s.touchClientOrderLocked(ck)
	s.mu.Unlock()

	for _, oldClient := range evicted {
		_ = oldClient.Close()
	}
	return client, nil
}

func stripHostBrackets(host string) string {
	host = strings.TrimSpace(host)
	if strings.HasPrefix(host, "[") && strings.HasSuffix(host, "]") {
		return strings.TrimSpace(host[1 : len(host)-1])
	}
	return host
}

func newRedisClient(record connectionRecord) (redis.UniversalClient, error) {
	host := stripHostBrackets(record.Host)
	if host == "" {
		return nil, errors.New("redis host is required")
	}
	port := record.Port
	if port <= 0 {
		port = defaultPort
	}
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	var tlsConfig *tls.Config
	if record.TLS {
		tlsConfig = &tls.Config{
			MinVersion:         tls.VersionTLS12,
			ServerName:         host,
			InsecureSkipVerify: record.TLSSkipVerify,
		}
	}
	mode := strings.ToLower(strings.TrimSpace(record.Mode))
	switch mode {
	case "cluster":
		addrs := splitAddresses(record.SeedNodes)
		if len(addrs) == 0 {
			addrs = []string{addr}
		}
		return redis.NewClusterClient(&redis.ClusterOptions{
			Addrs:        addrs,
			Username:     record.Username,
			Password:     record.Password,
			TLSConfig:    tlsConfig,
			DialTimeout:  defaultDialTimeout,
			ReadTimeout:  defaultReadTimeout,
			WriteTimeout: defaultWriteTimeout,
		}), nil
	case "sentinel":
		addrs := splitAddresses(record.SeedNodes)
		if len(addrs) == 0 {
			addrs = []string{addr}
		}
		master := strings.TrimSpace(record.SentinelMaster)
		if master == "" {
			master = "mymaster"
		}
		return redis.NewFailoverClient(&redis.FailoverOptions{
			MasterName:    master,
			SentinelAddrs: addrs,
			Username:      record.Username,
			Password:      record.Password,
			DB:            record.DB,
			TLSConfig:     tlsConfig,
			DialTimeout:   defaultDialTimeout,
			ReadTimeout:   defaultReadTimeout,
			WriteTimeout:  defaultWriteTimeout,
		}), nil
	default:
		return redis.NewClient(&redis.Options{
			Addr:         addr,
			Username:     record.Username,
			Password:     record.Password,
			DB:           record.DB,
			TLSConfig:    tlsConfig,
			DialTimeout:  defaultDialTimeout,
			ReadTimeout:  defaultReadTimeout,
			WriteTimeout: defaultWriteTimeout,
		}), nil
	}
}

func splitAddresses(value string) []string {
	parts := strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == '\n' || r == ' ' || r == '\t' })
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if strings.TrimSpace(part) != "" {
			result = append(result, strings.TrimSpace(part))
		}
	}
	return result
}
