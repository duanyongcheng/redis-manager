package main

import "time"

const (
	appName                   = "Redis Manager"
	defaultPort               = 6379
	defaultDB                 = 0
	defaultScan               = 200
	maxScanCount              = 1000
	metadataBatchSize         = 200
	maxCollectionItems        = 2000
	maxStreamItems            = 500
	maxStringLoadBytes        = 4 * 1024 * 1024
	maxCachedDBClientsPerConn = 8
	maxClusterScanCursors     = 256

	defaultDialTimeout  = 5 * time.Second
	defaultReadTimeout  = 15 * time.Second
	defaultWriteTimeout = 15 * time.Second

	readOnlyConnectionErrText = "当前连接为只读模式，不允许修改或删除数据"
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
	TLSSkipVerify  bool   `json:"tlsSkipVerify,omitempty"`
	ReadOnly       bool   `json:"readOnly"`
	Color          string `json:"color,omitempty"`
	SeedNodes      string `json:"seedNodes,omitempty"`
	SentinelMaster string `json:"sentinelMaster,omitempty"`
}

type connectionRecord struct {
	Connection
	Password          string `json:"password,omitempty"`
	EncryptedPassword string `json:"encryptedPassword,omitempty"`
	CredentialStore   string `json:"credentialStore,omitempty"`
}

type clientKey struct {
	id string
	db int
}

type clusterScanCursor struct {
	connID      string
	shardIdx    int
	shardCursor uint64
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
	TotalCount  int64             `json:"totalCount,omitempty"`
	Truncated   bool              `json:"truncated,omitempty"`
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
