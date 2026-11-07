package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"github.com/redis/go-redis/v9"
)

const (
	appName           = "Redis Manager"
	defaultPort       = 6379
	defaultDB         = 0
	defaultScan       = 200
	maxScanCount      = 1000
	metadataBatchSize = 200
)

// Connection is the public connection definition. Passwords are kept in the
// local record and are never returned to the frontend.
type Connection struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Group          string `json:"group"`
	Host           string `json:"host"`
	Port           int    `json:"port"`
	DB             int    `json:"db"`
	Mode           string `json:"mode"`
	Username       string `json:"username,omitempty"`
	TLS            bool   `json:"tls"`
	ReadOnly       bool   `json:"readOnly"`
	Color          string `json:"color,omitempty"`
	SeedNodes      string `json:"seedNodes,omitempty"`
	SentinelMaster string `json:"sentinelMaster,omitempty"`
}

type connectionRecord struct {
	Connection
	Password string `json:"password,omitempty"`
}

// ConnectionTest is returned by TestConnection before a connection is saved.
type ConnectionTest struct {
	Status    string  `json:"status"`
	Message   string  `json:"message"`
	Version   string  `json:"version"`
	Mode      string  `json:"mode"`
	LatencyMS float64 `json:"latencyMs"`
	DBCount   int     `json:"dbCount"`
}

type KeyMeta struct {
	Key       string `json:"key"`
	Type      string `json:"type"`
	TTLMS     int64  `json:"ttlMs"`
	SizeBytes int64  `json:"sizeBytes"`
	Encoding  string `json:"encoding"`
}

type KeyPage struct {
	Keys   []KeyMeta `json:"keys"`
	Cursor uint64    `json:"cursor"`
	Done   bool      `json:"done"`
}

type ZSetEntry struct {
	Member string  `json:"member"`
	Score  float64 `json:"score"`
}

type StreamEntry struct {
	ID     string            `json:"id"`
	Values map[string]string `json:"values"`
}

type RedisValue struct {
	Key         string            `json:"key"`
	Type        string            `json:"type"`
	TTLMs       int64             `json:"ttlMs"`
	SizeBytes   int64             `json:"sizeBytes"`
	Encoding    string            `json:"encoding"`
	StringValue string            `json:"stringValue,omitempty"`
	Hash        map[string]string `json:"hash,omitempty"`
	List        []string          `json:"list,omitempty"`
	Set         []string          `json:"set,omitempty"`
	ZSet        []ZSetEntry       `json:"zset,omitempty"`
	Stream      []StreamEntry     `json:"stream,omitempty"`
}

type CLILine struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
}

type CLIResult struct {
	Lines      []CLILine `json:"lines"`
	DurationMS float64   `json:"durationMs"`
}

type ServerMetrics struct {
	OpsPerSec        float64 `json:"opsPerSec"`
	ConnectedClients int     `json:"connectedClients"`
	UsedMemoryBytes  int64   `json:"usedMemoryBytes"`
	KeyCount         int64   `json:"keyCount"`
	RedisVersion     string  `json:"redisVersion"`
}

type KeyspaceSnapshot struct {
	DB       int   `json:"db"`
	Keys     int64 `json:"keys"`
	Expires  int64 `json:"expires"`
	AvgTTLMS int64 `json:"avgTtlMs"`
}

type CommandSnapshot struct {
	Name        string  `json:"name"`
	Calls       int64   `json:"calls"`
	Usec        int64   `json:"usec"`
	UsecPerCall float64 `json:"usecPerCall"`
	Rejected    int64   `json:"rejected"`
	Failed      int64   `json:"failed"`
}

type OverviewSnapshot struct {
	AtMs             int64              `json:"atMs"`
	OpsPerSec        float64            `json:"opsPerSec"`
	ConnectedClients int                `json:"connectedClients"`
	UsedMemoryBytes  int64              `json:"usedMemoryBytes"`
	MaxMemoryBytes   int64              `json:"maxMemoryBytes"`
	LatencyMS        float64            `json:"latencyMs"`
	TotalKeys        int64              `json:"totalKeys"`
	Keyspaces        []KeyspaceSnapshot `json:"keyspaces"`
	Commands         []CommandSnapshot  `json:"commands"`
	Info             map[string]string  `json:"info"`
}

type SlowlogEntry struct {
	ID         int64    `json:"id"`
	At         int64    `json:"at"`
	DurationUS int64    `json:"durationUs"`
	Command    []string `json:"command"`
	Client     string   `json:"client"`
}

type RedisClient struct {
	ID      int64  `json:"id"`
	Addr    string `json:"addr"`
	Name    string `json:"name"`
	Age     int64  `json:"age"`
	Idle    int64  `json:"idle"`
	DB      int    `json:"db"`
	Command string `json:"command"`
}

type ReplicaSnapshot struct {
	ID             int64  `json:"id"`
	Addr           string `json:"addr"`
	State          string `json:"state"`
	Lag            int64  `json:"lag"`
	SyncInProgress bool   `json:"syncInProgress"`
}

type ReplicationSnapshot struct {
	Role       string            `json:"role"`
	MasterHost string            `json:"masterHost"`
	MasterPort int               `json:"masterPort"`
	MasterLink string            `json:"masterLink"`
	Replicas   []ReplicaSnapshot `json:"replicas"`
}

type MonitorSnapshot struct {
	Overview    OverviewSnapshot    `json:"overview"`
	Slowlog     []SlowlogEntry      `json:"slowlog"`
	Clients     []RedisClient       `json:"clients"`
	Replication ReplicationSnapshot `json:"replication"`
}

// RedisService owns saved connections and lazily creates Redis clients.
type RedisService struct {
	mu        sync.Mutex
	records   map[string]connectionRecord
	clients   map[string]redis.UniversalClient
	clientDBs map[string]int
}

func NewRedisService() *RedisService {
	return &RedisService{
		records:   make(map[string]connectionRecord),
		clients:   make(map[string]redis.UniversalClient),
		clientDBs: make(map[string]int),
	}
}

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

// SaveConnection writes a connection definition and its password to a local
// file with owner-only permissions. A later keychain integration can replace
// this storage without changing the frontend contract.
func (s *RedisService) SaveConnection(input Connection, password string) error {
	input = normalizeConnection(input)
	if input.Name == "" {
		input.Name = input.Host
	}
	if input.Host == "" {
		return errors.New("redis host is required")
	}
	if err := s.ensureLoaded(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if password == "" {
		if existing, ok := s.records[input.ID]; ok {
			password = existing.Password
		}
	}
	filePassword := ""
	if password != "" {
		if err := savePassword(input.ID, password); err != nil {
			// Keep the app usable when a credential store is unavailable. The
			// fallback file is written with owner-only permissions.
			filePassword = password
		}
	}
	s.records[input.ID] = connectionRecord{Connection: input, Password: filePassword}
	if client, ok := s.clients[input.ID]; ok {
		_ = client.Close()
		delete(s.clients, input.ID)
		delete(s.clientDBs, input.ID)
	}
	return s.saveLocked()
}

// DeleteConnection removes a saved connection and closes its cached client.
func (s *RedisService) DeleteConnection(id string) error {
	if err := s.ensureLoaded(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if client, ok := s.clients[id]; ok {
		_ = client.Close()
		delete(s.clients, id)
		delete(s.clientDBs, id)
	}
	_ = mygo.Secrets.Service(appName).Delete(passwordSecretKey(id))
	delete(s.records, id)
	return s.saveLocked()
}

// TestConnection pings a Redis server and returns a small INFO summary.
func (s *RedisService) TestConnection(input Connection, password string) (ConnectionTest, error) {
	input = normalizeConnection(input)
	if input.Host == "" {
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
		if raw, configErr := client.Do(ctx, "CONFIG", "GET", "databases").Result(); configErr == nil {
			values := anyStrings(raw)
			if len(values) > 1 {
				result.DBCount = parseInt(values[1])
			}
		}
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
	record = hydratePassword(record)
	return s.TestConnection(record.Connection, record.Password)
}

// ScanKeys reads one Redis SCAN page and enriches every key with metadata.
func (s *RedisService) ScanKeys(connID string, db int, pattern string, cursor uint64, count int) (KeyPage, error) {
	client, err := s.clientFor(connID, db)
	if err != nil {
		return KeyPage{}, err
	}
	if count <= 0 {
		count = defaultScan
	}
	if count > maxScanCount {
		count = maxScanCount
	}
	if strings.TrimSpace(pattern) == "" {
		pattern = "*"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	keys, next, err := client.Scan(ctx, cursor, pattern, int64(count)).Result()
	if err != nil {
		return KeyPage{}, err
	}
	page := KeyPage{Cursor: next, Done: next == 0, Keys: make([]KeyMeta, 0, len(keys))}
	page.Keys = enrichKeyMetadata(ctx, client, keys)
	return page, nil
}

type keyMetadataCommands struct {
	typ      *redis.StatusCmd
	ttl      *redis.DurationCmd
	size     *redis.IntCmd
	encoding *redis.StringCmd
}

// enrichKeyMetadata batches the per-key lookups so a remote Redis server only
// needs a small number of network round trips for each SCAN page.
func enrichKeyMetadata(ctx context.Context, client redis.UniversalClient, keys []string) []KeyMeta {
	result := make([]KeyMeta, 0, len(keys))
	for start := 0; start < len(keys); start += metadataBatchSize {
		end := start + metadataBatchSize
		if end > len(keys) {
			end = len(keys)
		}
		batch := keys[start:end]
		commands := make([]keyMetadataCommands, len(batch))
		_, _ = client.Pipelined(ctx, func(pipe redis.Pipeliner) error {
			for i, key := range batch {
				commands[i] = keyMetadataCommands{
					typ:      pipe.Type(ctx, key),
					ttl:      pipe.PTTL(ctx, key),
					size:     pipe.MemoryUsage(ctx, key),
					encoding: pipe.ObjectEncoding(ctx, key),
				}
			}
			return nil
		})
		for i, key := range batch {
			commandsForKey := commands[i]
			meta := KeyMeta{Key: key, TTLMS: -1}
			if typ, err := commandsForKey.typ.Result(); err == nil {
				meta.Type = typ
			}
			if ttl, err := commandsForKey.ttl.Result(); err == nil {
				meta.TTLMS = ttl.Milliseconds()
			}
			if size, err := commandsForKey.size.Result(); err == nil {
				meta.SizeBytes = size
			}
			if encoding, err := commandsForKey.encoding.Result(); err == nil {
				meta.Encoding = encoding
			}
			result = append(result, meta)
		}
	}
	return result
}

// GetValue reads a key and returns a type-specific value representation.
func (s *RedisService) GetValue(connID string, db int, key string) (RedisValue, error) {
	client, err := s.clientFor(connID, db)
	if err != nil {
		return RedisValue{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var typCmd *redis.StatusCmd
	var ttlCmd *redis.DurationCmd
	var sizeCmd *redis.IntCmd
	var encodingCmd *redis.StringCmd
	_, _ = client.Pipelined(ctx, func(pipe redis.Pipeliner) error {
		typCmd = pipe.Type(ctx, key)
		ttlCmd = pipe.PTTL(ctx, key)
		sizeCmd = pipe.MemoryUsage(ctx, key)
		encodingCmd = pipe.ObjectEncoding(ctx, key)
		return nil
	})
	typ, typeErr := typCmd.Result()
	if typeErr != nil {
		return RedisValue{}, typeErr
	}
	value := RedisValue{Key: key, Type: typ, TTLMs: -1}
	if ttl, ttlErr := ttlCmd.Result(); ttlErr == nil {
		value.TTLMs = ttl.Milliseconds()
	}
	if size, sizeErr := sizeCmd.Result(); sizeErr == nil {
		value.SizeBytes = size
	}
	if encoding, encodingErr := encodingCmd.Result(); encodingErr == nil {
		value.Encoding = encoding
	}
	switch typ {
	case "string":
		value.StringValue, err = client.Get(ctx, key).Result()
	case "hash":
		value.Hash, err = client.HGetAll(ctx, key).Result()
	case "list":
		value.List, err = client.LRange(ctx, key, 0, 4999).Result()
	case "set":
		value.Set, err = client.SMembers(ctx, key).Result()
	case "zset":
		items, zErr := client.ZRangeWithScores(ctx, key, 0, 4999).Result()
		err = zErr
		for _, item := range items {
			value.ZSet = append(value.ZSet, ZSetEntry{Member: fmt.Sprint(item.Member), Score: item.Score})
		}
	case "stream":
		items, xErr := client.XRange(ctx, key, "-", "+").Result()
		err = xErr
		for _, item := range items {
			fields := make(map[string]string, len(item.Values))
			for field, fieldValue := range item.Values {
				fields[field] = fmt.Sprint(fieldValue)
			}
			value.Stream = append(value.Stream, StreamEntry{ID: item.ID, Values: fields})
		}
	default:
		err = fmt.Errorf("unsupported redis type %q", typ)
	}
	if err != nil {
		return RedisValue{}, err
	}
	return value, nil
}

// DeleteKey deletes one key after the frontend's confirmation step.
func (s *RedisService) DeleteKey(connID string, db int, key string) error {
	client, err := s.clientFor(connID, db)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return client.Del(ctx, key).Err()
}

// HashSet sets one field in a hash.
func (s *RedisService) HashSet(connID string, db int, key, field, value string) error {
	if field == "" {
		return errors.New("hash field is required")
	}
	client, err := s.clientFor(connID, db)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return client.HSet(ctx, key, field, value).Err()
}

// ExecCLI executes one command and returns terminal-friendly output lines.
func (s *RedisService) ExecCLI(connID string, db int, line string, readOnly bool) (CLIResult, error) {
	args, err := splitCommand(line)
	if err != nil {
		return CLIResult{}, err
	}
	if len(args) == 0 {
		return CLIResult{}, errors.New("command is empty")
	}
	command := strings.ToLower(args[0])
	if readOnly && writeCommands[command] {
		return CLIResult{Lines: []CLILine{{Kind: "error", Text: fmt.Sprintf("只读模式已拦截 %s 命令，请切换到可写模式后重试。", strings.ToUpper(command))}}}, nil
	}
	if command == "keys" {
		return CLIResult{Lines: []CLILine{{Kind: "error", Text: "KEYS 可能阻塞实例，请使用 SCAN 0 MATCH ... COUNT 1000。"}}}, nil
	}
	client, err := s.clientFor(connID, db)
	if err != nil {
		return CLIResult{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	start := time.Now()
	commandArgs := make([]any, len(args))
	for i, arg := range args {
		commandArgs[i] = arg
	}
	result, err := client.Do(ctx, commandArgs...).Result()
	if err != nil {
		return CLIResult{Lines: []CLILine{{Kind: "error", Text: err.Error()}}, DurationMS: elapsedMS(start)}, nil
	}
	return CLIResult{Lines: formatCLIResult(result), DurationMS: elapsedMS(start)}, nil
}

// GetMetrics returns a lightweight INFO snapshot for the status bar.
func (s *RedisService) GetMetrics(connID string, db int) (ServerMetrics, error) {
	client, err := s.clientFor(connID, db)
	if err != nil {
		return ServerMetrics{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	info, err := client.Info(ctx, "server", "stats", "clients", "memory", "keyspace").Result()
	if err != nil {
		return ServerMetrics{}, err
	}
	fields := parseInfo(info)
	metrics := ServerMetrics{
		RedisVersion:     fields["redis_version"],
		OpsPerSec:        parseFloat(fields["instantaneous_ops_per_sec"]),
		ConnectedClients: parseInt(fields["connected_clients"]),
		UsedMemoryBytes:  int64(parseFloat(fields["used_memory"])),
	}
	for key, value := range fields {
		if strings.HasPrefix(key, "db") && strings.Contains(value, "keys=") {
			parts := strings.Split(value, ",")
			if len(parts) > 0 {
				metrics.KeyCount += int64(parseInt(strings.TrimPrefix(parts[0], "keys=")))
			}
		}
	}
	return metrics, nil
}

// GetOverview reads one live snapshot for the selected Redis database.
func (s *RedisService) GetOverview(connID string, db int) (OverviewSnapshot, error) {
	client, err := s.clientFor(connID, db)
	if err != nil {
		return OverviewSnapshot{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	start := time.Now()
	info, err := client.Info(ctx, "server", "stats", "clients", "memory", "keyspace", "commandstats", "replication").Result()
	if err != nil {
		return OverviewSnapshot{}, err
	}
	fields := parseInfo(info)
	snapshot := OverviewSnapshot{
		AtMs:             time.Now().UnixMilli(),
		OpsPerSec:        parseFloat(fields["instantaneous_ops_per_sec"]),
		ConnectedClients: parseInt(fields["connected_clients"]),
		UsedMemoryBytes:  parseInt64(fields["used_memory"]),
		MaxMemoryBytes:   parseInt64(fields["maxmemory"]),
		LatencyMS:        elapsedMS(start),
		Info:             fields,
	}
	snapshot.Keyspaces = parseKeyspaces(fields)
	for _, keyspace := range snapshot.Keyspaces {
		snapshot.TotalKeys += keyspace.Keys
	}
	snapshot.Commands = parseCommands(fields)
	return snapshot, nil
}

// GetMonitorSnapshot collects the live monitor tables used by the UI.
func (s *RedisService) GetMonitorSnapshot(connID string, db int) (MonitorSnapshot, error) {
	client, err := s.clientFor(connID, db)
	if err != nil {
		return MonitorSnapshot{}, err
	}
	overview, err := s.GetOverview(connID, db)
	if err != nil {
		return MonitorSnapshot{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	snapshot := MonitorSnapshot{Overview: overview, Replication: parseReplication(overview.Info)}
	if raw, rawErr := client.Do(ctx, "SLOWLOG", "GET", 20).Result(); rawErr == nil {
		snapshot.Slowlog = parseSlowlog(raw)
	}
	if raw, rawErr := client.Do(ctx, "CLIENT", "LIST").Result(); rawErr == nil {
		snapshot.Clients = parseClients(fmt.Sprint(raw))
	}
	return snapshot, nil
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

func (s *RedisService) ensureLoaded() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.records == nil {
		s.records = make(map[string]connectionRecord)
	}
	if s.clients == nil {
		s.clients = make(map[string]redis.UniversalClient)
	}
	if s.clientDBs == nil {
		s.clientDBs = make(map[string]int)
	}
	if len(s.records) > 0 {
		return nil
	}
	path, err := configFilePath()
	if err != nil {
		return err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var records []connectionRecord
	if err := json.Unmarshal(data, &records); err != nil {
		return fmt.Errorf("decode connections: %w", err)
	}
	for _, record := range records {
		record.Connection = normalizeConnection(record.Connection)
		s.records[record.ID] = record
	}
	return nil
}

func (s *RedisService) saveLocked() error {
	path, err := configFilePath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
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
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func configFilePath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, appName, "connections.json"), nil
}

func passwordSecretKey(id string) string {
	return "connection/" + id
}

func savePassword(id, password string) error {
	return mygo.Secrets.Service(appName).Set(passwordSecretKey(id), []byte(password))
}

func hydratePassword(record connectionRecord) connectionRecord {
	if record.Password != "" {
		return record
	}
	password, err := mygo.Secrets.Service(appName).Get(passwordSecretKey(record.ID))
	if err == nil {
		record.Password = string(password)
	}
	return record
}

func (s *RedisService) clientFor(id string, db int) (redis.UniversalClient, error) {
	if err := s.ensureLoaded(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.clients == nil {
		s.clients = make(map[string]redis.UniversalClient)
	}
	if s.clientDBs == nil {
		s.clientDBs = make(map[string]int)
	}
	record, ok := s.records[id]
	if !ok {
		return nil, fmt.Errorf("connection %q not found", id)
	}
	if db < 0 {
		db = record.DB
	}
	if client, ok := s.clients[id]; ok {
		if currentDB, hasDB := s.clientDBs[id]; hasDB && currentDB == db {
			return client, nil
		}
		_ = client.Close()
		delete(s.clients, id)
		delete(s.clientDBs, id)
	}
	record = hydratePassword(record)
	record.DB = db
	client, err := newRedisClient(record)
	if err != nil {
		return nil, err
	}
	s.clients[id] = client
	s.clientDBs[id] = db
	return client, nil
}

func newRedisClient(record connectionRecord) (redis.UniversalClient, error) {
	host := strings.TrimSpace(record.Host)
	if host == "" {
		return nil, errors.New("redis host is required")
	}
	addr := fmt.Sprintf("%s:%d", host, record.Port)
	tlsConfig := (*tls.Config)(nil)
	if record.TLS {
		tlsConfig = &tls.Config{MinVersion: tls.VersionTLS12, ServerName: host}
	}
	mode := strings.ToLower(strings.TrimSpace(record.Mode))
	switch mode {
	case "cluster":
		addrs := splitAddresses(record.SeedNodes)
		if len(addrs) == 0 {
			addrs = []string{addr}
		}
		return redis.NewClusterClient(&redis.ClusterOptions{
			Addrs: addrs, Username: record.Username, Password: record.Password, TLSConfig: tlsConfig,
		}), nil
	case "sentinel":
		addrs := splitAddresses(record.SeedNodes)
		if len(addrs) == 0 {
			addrs = []string{addr}
		}
		master := record.SentinelMaster
		if master == "" {
			master = "mymaster"
		}
		return redis.NewFailoverClient(&redis.FailoverOptions{
			MasterName: master, SentinelAddrs: addrs, Username: record.Username, Password: record.Password, DB: record.DB, TLSConfig: tlsConfig,
		}), nil
	default:
		return redis.NewClient(&redis.Options{
			Addr: addr, Username: record.Username, Password: record.Password, DB: record.DB, TLSConfig: tlsConfig,
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

func parseInfo(info string) map[string]string {
	fields := make(map[string]string)
	for _, line := range strings.Split(info, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, ":")
		if ok {
			fields[key] = strings.TrimSpace(value)
		}
	}
	return fields
}

func parseInt(value string) int {
	n, _ := strconv.Atoi(strings.TrimSpace(value))
	return n
}

func parseFloat(value string) float64 {
	n, _ := strconv.ParseFloat(strings.TrimSpace(value), 64)
	return n
}

func parseInt64(value string) int64 {
	n, _ := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	return n
}

func parseKeyspaces(fields map[string]string) []KeyspaceSnapshot {
	result := make([]KeyspaceSnapshot, 0)
	for key, value := range fields {
		if !strings.HasPrefix(key, "db") {
			continue
		}
		db, err := strconv.Atoi(strings.TrimPrefix(key, "db"))
		if err != nil {
			continue
		}
		metrics := parseMetricList(value)
		result = append(result, KeyspaceSnapshot{
			DB: db, Keys: parseInt64(metrics["keys"]), Expires: parseInt64(metrics["expires"]), AvgTTLMS: parseInt64(metrics["avg_ttl"]),
		})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].DB < result[j].DB })
	return result
}

func parseCommands(fields map[string]string) []CommandSnapshot {
	result := make([]CommandSnapshot, 0)
	for key, value := range fields {
		if !strings.HasPrefix(key, "cmdstat_") {
			continue
		}
		metrics := parseMetricList(value)
		name := strings.TrimPrefix(key, "cmdstat_")
		result = append(result, CommandSnapshot{
			Name: name, Calls: parseInt64(metrics["calls"]), Usec: parseInt64(metrics["usec"]),
			UsecPerCall: parseFloat(metrics["usec_per_call"]), Rejected: parseInt64(metrics["rejected_calls"]), Failed: parseInt64(metrics["failed_calls"]),
		})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Calls == result[j].Calls {
			return result[i].Name < result[j].Name
		}
		return result[i].Calls > result[j].Calls
	})
	if len(result) > 20 {
		result = result[:20]
	}
	return result
}

func parseMetricList(value string) map[string]string {
	result := make(map[string]string)
	for _, pair := range strings.Split(value, ",") {
		key, item, ok := strings.Cut(pair, "=")
		if ok {
			result[strings.TrimSpace(key)] = strings.TrimSpace(item)
		}
	}
	return result
}

func parseReplication(fields map[string]string) ReplicationSnapshot {
	result := ReplicationSnapshot{
		Role: fields["role"], MasterHost: fields["master_host"], MasterPort: parseInt(fields["master_port"]), MasterLink: fields["master_link_status"],
		Replicas: make([]ReplicaSnapshot, 0),
	}
	count := parseInt(fields["connected_slaves"])
	for index := 0; index < count; index++ {
		metrics := parseMetricList(fields[fmt.Sprintf("slave%d", index)])
		result.Replicas = append(result.Replicas, ReplicaSnapshot{
			ID: int64(index), Addr: netAddress(metrics["ip"], metrics["port"]), State: metrics["state"], Lag: parseInt64(metrics["lag"]),
			SyncInProgress: metrics["sync_in_progress"] == "1",
		})
	}
	return result
}

func netAddress(host, port string) string {
	if host == "" {
		return ""
	}
	if port == "" {
		return host
	}
	return host + ":" + port
}

func parseSlowlog(value any) []SlowlogEntry {
	rows, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]SlowlogEntry, 0, len(rows))
	for _, rowValue := range rows {
		row, ok := rowValue.([]any)
		if !ok || len(row) < 4 {
			continue
		}
		entry := SlowlogEntry{ID: anyInt64(row[0]), At: anyInt64(row[1]), DurationUS: anyInt64(row[2]), Command: anyStrings(row[3])}
		if len(row) > 4 {
			entry.Client = anyString(row[4])
		}
		result = append(result, entry)
	}
	return result
}

func parseClients(value string) []RedisClient {
	result := make([]RedisClient, 0)
	for _, line := range strings.Split(strings.TrimSpace(value), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		fields := make(map[string]string)
		for _, pair := range strings.Fields(line) {
			key, item, ok := strings.Cut(pair, "=")
			if ok {
				fields[key] = strings.ReplaceAll(item, "\\x20", " ")
			}
		}
		result = append(result, RedisClient{
			ID: parseInt64(fields["id"]), Addr: fields["addr"], Name: fields["name"], Age: parseInt64(fields["age"]), Idle: parseInt64(fields["idle"]), DB: parseInt(fields["db"]), Command: fields["cmd"],
		})
	}
	return result
}

func anyString(value any) string {
	if value == nil {
		return ""
	}
	return fmt.Sprint(value)
}

func anyInt64(value any) int64 {
	switch item := value.(type) {
	case int:
		return int64(item)
	case int64:
		return item
	case uint64:
		return int64(item)
	case float64:
		return int64(item)
	default:
		return parseInt64(anyString(value))
	}
}

func anyStrings(value any) []string {
	result := make([]string, 0)
	switch item := value.(type) {
	case []any:
		for _, child := range item {
			result = append(result, anyString(child))
		}
	case []string:
		result = append(result, item...)
	default:
		if text := anyString(value); text != "" {
			result = append(result, text)
		}
	}
	return result
}

func elapsedMS(start time.Time) float64 {
	return float64(time.Since(start).Microseconds()) / 1000
}

func formatCLIResult(value any) []CLILine {
	if value == nil {
		return []CLILine{{Kind: "nil", Text: "(nil)"}}
	}
	switch item := value.(type) {
	case []any:
		lines := make([]CLILine, 0, len(item)+1)
		for i, child := range item {
			for j, line := range formatCLIResult(child) {
				prefix := fmt.Sprintf("%d) ", i+1)
				if j > 0 {
					prefix = "   "
				}
				lines = append(lines, CLILine{Kind: "ok", Text: prefix + line.Text})
			}
		}
		return lines
	case []string:
		lines := make([]CLILine, 0, len(item))
		for i, child := range item {
			lines = append(lines, CLILine{Kind: "ok", Text: fmt.Sprintf("%d) %s", i+1, child)})
		}
		return lines
	case int64:
		return []CLILine{{Kind: "integer", Text: fmt.Sprintf("(integer) %d", item)}}
	case int:
		return []CLILine{{Kind: "integer", Text: fmt.Sprintf("(integer) %d", item)}}
	case string:
		return []CLILine{{Kind: "string", Text: item}}
	default:
		return []CLILine{{Kind: "ok", Text: fmt.Sprint(item)}}
	}
}

func splitCommand(line string) ([]string, error) {
	var args []string
	var current strings.Builder
	var quote rune
	escaped := false
	flush := func() {
		if current.Len() > 0 {
			args = append(args, current.String())
			current.Reset()
		}
	}
	for _, r := range strings.TrimSpace(line) {
		if escaped {
			current.WriteRune(r)
			escaped = false
			continue
		}
		if r == '\\' && quote != '\'' {
			escaped = true
			continue
		}
		if quote != 0 {
			if r == quote {
				quote = 0
			} else {
				current.WriteRune(r)
			}
			continue
		}
		if r == '\'' || r == '"' {
			quote = r
			continue
		}
		if r == ' ' || r == '\t' || r == '\n' {
			flush()
			continue
		}
		current.WriteRune(r)
	}
	if escaped {
		return nil, errors.New("unfinished escape in command")
	}
	if quote != 0 {
		return nil, errors.New("unfinished quote in command")
	}
	flush()
	return args, nil
}

var writeCommands = map[string]bool{
	"append": true, "auth": true, "bgrewriteaof": true, "bgsave": true, "config": true,
	"del": true, "flushall": true, "flushdb": true, "hdel": true, "hset": true, "hmset": true,
	"incr": true, "incrby": true, "lpop": true, "lpush": true, "lrem": true, "lset": true,
	"ltrim": true, "mset": true, "persist": true, "pexpire": true, "rename": true, "rpop": true,
	"rpush": true, "sadd": true, "set": true, "setex": true, "srem": true, "sunionstore": true,
	"unlink": true, "xadd": true, "xdel": true, "xtrim": true, "zadd": true, "zrem": true,
}

func main() {
	service := NewRedisService()
	mygo.Bind(service)
	mygo.App.WhenReady(func() {
		mygo.NewWindow(mygo.WindowOptions{
			Title:           appName,
			Width:           1440,
			Height:          900,
			MinWidth:        1040,
			MinHeight:       680,
			BackgroundColor: "#0d1015",
			StateKey:        "main",
			URL:             "/",
		})
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
