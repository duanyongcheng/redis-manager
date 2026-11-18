package main

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// mockRESPServer is a lightweight in-process RESP2 server for deterministic unit testing.
type mockRESPServer struct {
	ln       net.Listener
	mu       sync.Mutex
	commands [][]string
	handler  func(connDB *int, args []string) string
}

func startMockRESPServer(t *testing.T, handler func(connDB *int, args []string) string) (*mockRESPServer, string, int) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen mock redis: %v", err)
	}
	srv := &mockRESPServer{ln: ln, handler: handler}
	t.Cleanup(func() { _ = ln.Close() })

	go func() {
		for {
			conn, acceptErr := ln.Accept()
			if acceptErr != nil {
				return
			}
			go srv.serveConn(conn)
		}
	}()

	tcpAddr := ln.Addr().(*net.TCPAddr)
	return srv, tcpAddr.IP.String(), tcpAddr.Port
}

func (m *mockRESPServer) serveConn(conn net.Conn) {
	defer conn.Close()
	reader := bufio.NewReader(conn)
	db := 0
	for {
		args, err := readRESPCommand(reader)
		if err != nil {
			return
		}
		if len(args) == 0 {
			continue
		}
		upper := strings.ToUpper(args[0])
		// Built-in handshake commands issued by go-redis v9 on connect.
		switch upper {
		case "HELLO":
			_, _ = io.WriteString(conn, "-ERR unknown command 'HELLO'\r\n")
			continue
		case "CLIENT":
			if len(args) > 1 && strings.EqualFold(args[1], "SETINFO") {
				_, _ = io.WriteString(conn, "+OK\r\n")
				continue
			}
		case "SELECT":
			if len(args) > 1 {
				db, _ = strconv.Atoi(args[1])
			}
			m.recordCommand(args)
			_, _ = io.WriteString(conn, "+OK\r\n")
			continue
		}

		m.recordCommand(args)
		reply := "+OK\r\n"
		if m.handler != nil {
			reply = m.handler(&db, args)
		}
		if _, err := io.WriteString(conn, reply); err != nil {
			return
		}
	}
}

func (m *mockRESPServer) recordCommand(args []string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := append([]string(nil), args...)
	m.commands = append(m.commands, cp)
}

func (m *mockRESPServer) recordedCommands() [][]string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([][]string, len(m.commands))
	for i, cmd := range m.commands {
		out[i] = append([]string(nil), cmd...)
	}
	return out
}

func readRESPCommand(r *bufio.Reader) ([]string, error) {
	line, err := r.ReadString('\n')
	if err != nil {
		return nil, err
	}
	line = strings.TrimRight(line, "\r\n")
	if line == "" {
		return nil, nil
	}
	if line[0] != '*' {
		return strings.Fields(line), nil
	}
	count, err := strconv.Atoi(line[1:])
	if err != nil {
		return nil, err
	}
	args := make([]string, 0, count)
	for i := 0; i < count; i++ {
		hdr, err := r.ReadString('\n')
		if err != nil {
			return nil, err
		}
		hdr = strings.TrimRight(hdr, "\r\n")
		if len(hdr) == 0 || hdr[0] != '$' {
			return nil, fmt.Errorf("expected bulk string header, got %q", hdr)
		}
		size, err := strconv.Atoi(hdr[1:])
		if err != nil {
			return nil, err
		}
		buf := make([]byte, size+2)
		if _, err := io.ReadFull(r, buf); err != nil {
			return nil, err
		}
		args = append(args, string(buf[:size]))
	}
	return args, nil
}

func respBulk(s string) string {
	return fmt.Sprintf("$%d\r\n%s\r\n", len(s), s)
}

func respInt(n int64) string {
	return fmt.Sprintf(":%d\r\n", n)
}

func respArray(elems ...string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "*%d\r\n", len(elems))
	for _, e := range elems {
		b.WriteString(e)
	}
	return b.String()
}

func respBulkArray(items []string) string {
	elems := make([]string, len(items))
	for i, item := range items {
		elems[i] = respBulk(item)
	}
	return respArray(elems...)
}

func TestParsersInfoKeyspacesCommandsReplicationSlowlogClients(t *testing.T) {
	rawInfo := `
# Server
redis_version:7.2.4
redis_mode:standalone

# Stats
instantaneous_ops_per_sec:1250

# Replication
role:master
connected_slaves:2
slave0:ip=10.0.0.12,port=6379,state=online,offset=991,lag=0,sync_in_progress=0
slave1:ip=2001:db8::42,port=6380,state=online,offset=980,lag=2,sync_in_progress=1

# Keyspace
db0:keys=120,expires=30,avg_ttl=45000
db2:keys=5,expires=0,avg_ttl=0
db_invalid:keys=999

# Commandstats
cmdstat_get:calls=500,usec=1500,usec_per_call=3.00,rejected_calls=0,failed_calls=1
cmdstat_set:calls=200,usec=1000,usec_per_call=5.00,rejected_calls=2,failed_calls=0
cmdstat_ping:calls=200,usec=200,usec_per_call=1.00,rejected_calls=0,failed_calls=0
`
	fields := parseInfo(rawInfo)
	if fields["redis_version"] != "7.2.4" || fields["instantaneous_ops_per_sec"] != "1250" {
		t.Fatalf("unexpected parsed info fields: %+v", fields)
	}

	keyspaces := parseKeyspaces(fields)
	if len(keyspaces) != 2 {
		t.Fatalf("keyspaces len = %d, want 2", len(keyspaces))
	}
	if keyspaces[0].DB != 0 || keyspaces[0].Keys != 120 || keyspaces[0].Expires != 30 || keyspaces[0].AvgTTLMS != 45000 {
		t.Fatalf("unexpected db0 keyspace: %+v", keyspaces[0])
	}
	if keyspaces[1].DB != 2 || keyspaces[1].Keys != 5 {
		t.Fatalf("unexpected db2 keyspace: %+v", keyspaces[1])
	}

	commands := parseCommands(fields)
	if len(commands) != 3 {
		t.Fatalf("commands len = %d, want 3", len(commands))
	}
	// Sorted by calls desc, then name asc on ties ("ping" before "set").
	if commands[0].Name != "get" || commands[1].Name != "ping" || commands[2].Name != "set" {
		t.Fatalf("unexpected command sort order: %+v", commands)
	}
	if commands[2].Rejected != 2 || commands[0].Failed != 1 {
		t.Fatalf("unexpected rejected/failed counts: %+v", commands)
	}

	rep := parseReplication(fields)
	if rep.Role != "master" || len(rep.Replicas) != 2 {
		t.Fatalf("unexpected replication snapshot: %+v", rep)
	}
	if rep.Replicas[0].Addr != "10.0.0.12:6379" || rep.Replicas[0].SyncInProgress {
		t.Fatalf("unexpected replica 0: %+v", rep.Replicas[0])
	}
	if rep.Replicas[1].Addr != "[2001:db8::42]:6380" || rep.Replicas[1].Lag != 2 || !rep.Replicas[1].SyncInProgress {
		t.Fatalf("unexpected IPv6 replica 1: %+v", rep.Replicas[1])
	}
	if got := netAddress("[::1]", "6379"); got != "[::1]:6379" {
		t.Fatalf("netAddress([::1], 6379) = %q, want [::1]:6379", got)
	}

	rawSlowlog := []any{
		[]any{int64(42), int64(1700000100), int64(15400), []any{"HGETALL", "big:hash"}, "127.0.0.1:53120"},
		[]any{int64(41), int64(1700000050), int64(11200), []string{"SCAN", "0"}},
		"malformed-entry",
	}
	slowlog := parseSlowlog(rawSlowlog)
	if len(slowlog) != 2 {
		t.Fatalf("slowlog len = %d, want 2", len(slowlog))
	}
	if slowlog[0].ID != 42 || slowlog[0].Client != "127.0.0.1:53120" || !reflect.DeepEqual(slowlog[0].Command, []string{"HGETALL", "big:hash"}) {
		t.Fatalf("unexpected slowlog[0]: %+v", slowlog[0])
	}
	if slowlog[1].ID != 41 || slowlog[1].Client != "" {
		t.Fatalf("unexpected slowlog[1]: %+v", slowlog[1])
	}

	rawClients := "id=10 addr=127.0.0.1:54001 name=worker\\x20pool\\x20#1 age=120 idle=3 db=2 cmd=get\nid=11 addr=[::1]:54002 name= age=5 idle=0 db=0 cmd=ping\n"
	clients := parseClients(rawClients)
	if len(clients) != 2 {
		t.Fatalf("clients len = %d, want 2", len(clients))
	}
	if clients[0].ID != 10 || clients[0].Name != "worker pool #1" || clients[0].DB != 2 || clients[0].Command != "get" {
		t.Fatalf("unexpected client[0]: %+v", clients[0])
	}
	if clients[1].Addr != "[::1]:54002" || clients[1].Name != "" {
		t.Fatalf("unexpected client[1]: %+v", clients[1])
	}
}

func TestSplitCommandAndFormatCLIResult(t *testing.T) {
	cases := []struct {
		line    string
		want    []string
		wantErr string
	}{
		{
			line: `SET "hello world" 'single\quote literal' plain\ arg`,
			want: []string{"SET", "hello world", `single\quote literal`, "plain arg"},
		},
		{
			line: "  HSET\tuser:1\nname \"Alice \\\"Bob\\\"\"  ",
			want: []string{"HSET", "user:1", "name", `Alice "Bob"`},
		},
		{
			line:    `SET key "unterminated`,
			wantErr: "unfinished quote",
		},
		{
			line:    `SET key trailing\`,
			wantErr: "unfinished escape",
		},
	}

	for _, tc := range cases {
		got, err := splitCommand(tc.line)
		if tc.wantErr != "" {
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("splitCommand(%q) err = %v, want substring %q", tc.line, err, tc.wantErr)
			}
			continue
		}
		if err != nil {
			t.Fatalf("splitCommand(%q) unexpected error: %v", tc.line, err)
		}
		if !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("splitCommand(%q) = %#v, want %#v", tc.line, got, tc.want)
		}
	}

	if got := formatCLIResult(nil); len(got) != 1 || got[0].Kind != "nil" || got[0].Text != "(nil)" {
		t.Fatalf("formatCLIResult(nil) = %+v", got)
	}
	if got := formatCLIResult(int64(99)); len(got) != 1 || got[0].Kind != "integer" || got[0].Text != "(integer) 99" {
		t.Fatalf("formatCLIResult(99) = %+v", got)
	}
	if got := formatCLIResult("PONG"); len(got) != 1 || got[0].Kind != "string" || got[0].Text != "PONG" {
		t.Fatalf("formatCLIResult(PONG) = %+v", got)
	}
	nested := formatCLIResult([]any{"0", []any{"k1", "k2"}})
	wantTexts := []string{"1) 0", "2) 1) k1", "   2) k2"}
	if len(nested) != len(wantTexts) {
		t.Fatalf("nested lines = %+v, want %v", nested, wantTexts)
	}
	for i, text := range wantTexts {
		if nested[i].Text != text {
			t.Fatalf("nested[%d].Text = %q, want %q", i, nested[i].Text, text)
		}
	}
}

func TestIsWriteOrMutatingCommandSubcommandsAndWriteSet(t *testing.T) {
	allowedReadOnly := []string{
		"GET user:1",
		"MGET a b",
		"SCAN 0 MATCH user:* COUNT 200",
		"HGETALL profile:1",
		"LRANGE queue 0 10",
		"SMEMBERS tags",
		"ZRANGE leaderboard 0 10 WITHSCORES",
		"XRANGE events - + COUNT 10",
		"TTL user:1",
		"PTTL user:1",
		"TYPE user:1",
		"DBSIZE",
		"INFO server",
		"LASTSAVE",
		"CONFIG GET maxmemory*",
		"CLIENT LIST",
		"CLIENT GETNAME",
		"CLIENT ID",
		"CLIENT INFO",
		"SLOWLOG GET 10",
		"SLOWLOG LEN",
		"MEMORY USAGE user:1",
		"MEMORY STATS",
		"MEMORY DOCTOR",
		"CLUSTER INFO",
		"CLUSTER NODES",
		"CLUSTER SLOTS",
		"CLUSTER SHARDS",
		"CLUSTER KEYSLOT user:1",
		"ACL WHOAMI",
		"ACL LIST",
		"ACL USERS",
		"ACL GETUSER default",
		"ACL CAT",
		"ACL LOG 5",
		"ACL DRYRUN default get k",
		"ACL GENPASS",
		"FUNCTION LIST",
		"FUNCTION STATS",
		"PUBSUB CHANNELS *",
		"PUBSUB NUMSUB ch1",
		"XINFO STREAM events",
		"XINFO GROUPS events",
		"OBJECT ENCODING user:1",
		"OBJECT IDLETIME user:1",
		"BITFIELD_RO flags GET u8 0",
		"GEORADIUS cities 13 38 100 km",
		"SORT items ALPHA",
	}

	for _, cmdLine := range allowedReadOnly {
		args, err := splitCommand(cmdLine)
		if err != nil {
			t.Fatalf("split %q: %v", cmdLine, err)
		}
		if isWriteOrMutatingCommand(args) {
			t.Errorf("expected %q to be ALLOWED in read-only mode, but was classified as write/mutating", cmdLine)
		}
	}

	blockedMutating := []string{
		"SET a 1",
		"SETNX a 1",
		"SETEX a 10 1",
		"PSETEX a 1000 1",
		"GETDEL a",
		"GETEX a EX 60",
		"MSET a 1 b 2",
		"INCR counter",
		"DECRBY counter 2",
		"DEL a",
		"UNLINK a",
		"EXPIRE a 10",
		"PERSIST a",
		"RENAME a b",
		"COPY a b",
		"MOVE a 1",
		"FLUSHDB",
		"FLUSHALL",
		"SWAPDB 0 1",
		"HSET h f v",
		"HDEL h f",
		"HEXPIRE h 10 FIELDS 1 f",
		"LPUSH l v",
		"LPOP l",
		"BLPOP l 1",
		"LMOVE l1 l2 LEFT RIGHT",
		"SADD s m",
		"SPOP s",
		"SUNIONSTORE dst s1 s2",
		"ZADD z 1 m",
		"ZPOPMIN z",
		"ZINTERSTORE dst 2 z1 z2",
		"XADD st * f v",
		"XTRIM st MAXLEN 100",
		"XGROUP CREATE st grp $",
		"PFADD hll a",
		"BITOP AND dst k1 k2",
		"BITFIELD flags SET u8 0 1",
		"GEOADD cities 13 38 Palermo",
		"GEOSEARCHSTORE dst cities FROMLONLAT 13 38 BYRADIUS 100 km",
		"GEORADIUS cities 13 38 100 km STORE dst",
		"SORT items STORE sorted:items",
		"EVAL 'return 1' 0",
		"EVALSHA deadbeef 0",
		"FCALL myfn 0",
		"SCRIPT FLUSH",
		"PUBLISH ch msg",
		"SPUBLISH sch msg",
		"BGSAVE",
		"BGREWRITEAOF",
		"SAVE",
		"REPLICAOF 127.0.0.1 6379",
		"FAILOVER",
		"AUTH secret",
		"CONFIG SET maxmemory 100mb",
		"CONFIG REWRITE",
		"CONFIG RESETSTAT",
		"CLIENT KILL ID 12",
		"CLIENT PAUSE 1000",
		"CLIENT SETNAME custom",
		"SLOWLOG RESET",
		"MEMORY PURGE",
		"CLUSTER FAILOVER",
		"CLUSTER MEET 10.0.0.2 6379",
		"CLUSTER RESET",
		"CLUSTER ADDSLOTS 1 2 3",
		"ACL SETUSER alice on",
		"ACL DELUSER alice",
		"ACL SAVE",
		"ACL LOG RESET",
		"FUNCTION LOAD payload",
		"FUNCTION DELETE lib",
		"FUNCTION FLUSH",
		"LATENCY RESET",
		"MODULE LOAD /tmp/mod.so",
	}

	for _, cmdLine := range blockedMutating {
		args, err := splitCommand(cmdLine)
		if err != nil {
			t.Fatalf("split %q: %v", cmdLine, err)
		}
		if !isWriteOrMutatingCommand(args) {
			t.Errorf("expected %q to be BLOCKED in read-only mode, but was allowed", cmdLine)
		}
	}
}

func TestExecCLIInterceptionAndConnectionReadOnlyEnforcement(t *testing.T) {
	srv, host, port := startMockRESPServer(t, func(_ *int, args []string) string {
		switch strings.ToUpper(args[0]) {
		case "CONFIG":
			return respBulkArray([]string{"maxmemory", "0"})
		case "CLIENT":
			return respBulk("id=1 addr=127.0.0.1:12345 name=test age=1 idle=0 db=0 cmd=client\n")
		case "GET":
			if len(args) > 1 && args[1] == "missing" {
				return "$-1\r\n"
			}
			return respBulk("val")
		default:
			return "+OK\r\n"
		}
	})

	dir := t.TempDir()
	svc := newTestRedisService(dir, newFakeSecretStore())

	if err := svc.SaveConnection(Connection{
		ID:       "ro-conn",
		Name:     "ReadOnly Instance",
		Host:     host,
		Port:     port,
		ReadOnly: true,
	}, ""); err != nil {
		t.Fatalf("SaveConnection ro-conn: %v", err)
	}
	if err := svc.SaveConnection(Connection{
		ID:       "rw-conn",
		Name:     "Writable Instance",
		Host:     host,
		Port:     port,
		ReadOnly: false,
	}, ""); err != nil {
		t.Fatalf("SaveConnection rw-conn: %v", err)
	}

	// 1. Always-intercepted dangerous/stateful commands even when connection and CLI are writable.
	alwaysIntercepted := map[string]string{
		"KEYS *":          "COUNT 200",
		"MONITOR":         "MONITOR",
		"SELECT 2":        "SELECT",
		"SHUTDOWN NOSAVE": "SHUTDOWN",
		"DEBUG SEGFAULT":  "DEBUG",
	}
	for cmdLine, wantSub := range alwaysIntercepted {
		res, err := svc.ExecCLI("rw-conn", 0, cmdLine, false)
		if err != nil {
			t.Fatalf("ExecCLI(%q) returned unexpected Go error: %v", cmdLine, err)
		}
		if len(res.Lines) != 1 || res.Lines[0].Kind != "error" || !strings.Contains(res.Lines[0].Text, wantSub) {
			t.Fatalf("ExecCLI(%q) = %+v, want error containing %q", cmdLine, res, wantSub)
		}
	}

	// 2. Connection ReadOnly=true blocks mutations even when CLI readOnly=false!
	for _, blocked := range []string{"SET k v", "CONFIG SET maxmemory 100", "CLIENT KILL ID 1"} {
		res, err := svc.ExecCLI("ro-conn", 0, blocked, false)
		if err != nil {
			t.Fatalf("ExecCLI(ro-conn, %q): %v", blocked, err)
		}
		if len(res.Lines) != 1 || res.Lines[0].Kind != "error" || !strings.Contains(res.Lines[0].Text, "只读模式") {
			t.Fatalf("expected read-only block for %q on ro-conn, got %+v", blocked, res)
		}
	}

	// 3. Connection ReadOnly=true still permits safe subcommands (CONFIG GET, CLIENT LIST) and GET missing -> (nil).
	cfgRes, err := svc.ExecCLI("ro-conn", 0, "CONFIG GET maxmemory", false)
	if err != nil || len(cfgRes.Lines) != 2 || cfgRes.Lines[0].Kind == "error" {
		t.Fatalf("expected CONFIG GET to succeed on ro-conn, got (%+v, %v)", cfgRes, err)
	}
	cliRes, err := svc.ExecCLI("ro-conn", 0, "CLIENT LIST", true)
	if err != nil || len(cliRes.Lines) != 1 || cliRes.Lines[0].Kind == "error" {
		t.Fatalf("expected CLIENT LIST to succeed on ro-conn, got (%+v, %v)", cliRes, err)
	}
	nilRes, err := svc.ExecCLI("ro-conn", 0, "GET missing", true)
	if err != nil || len(nilRes.Lines) != 1 || nilRes.Lines[0].Kind != "nil" || nilRes.Lines[0].Text != "(nil)" {
		t.Fatalf("expected GET missing -> (nil), got (%+v, %v)", nilRes, err)
	}

	// 4. Connection-level ReadOnly blocks all 5 mutating service methods without hitting Redis.
	beforeCmdCount := len(srv.recordedCommands())
	mutators := []struct {
		name string
		fn   func() error
	}{
		{"DeleteKey", func() error { return svc.DeleteKey("ro-conn", 0, "k") }},
		{"HashSet", func() error { return svc.HashSet("ro-conn", 0, "k", "f", "v") }},
		{"SetTTL", func() error { return svc.SetTTL("ro-conn", 0, "k", 60) }},
		{"SetString", func() error { return svc.SetString("ro-conn", 0, "k", "v") }},
		{"HashDelete", func() error { return svc.HashDelete("ro-conn", 0, "k", "f") }},
	}
	for _, m := range mutators {
		err := m.fn()
		if err == nil || err.Error() != readOnlyConnectionErrText {
			t.Fatalf("%s on ro-conn = %v, want %q", m.name, err, readOnlyConnectionErrText)
		}
	}
	if after := len(srv.recordedCommands()); after != beforeCmdCount {
		t.Fatalf("expected 0 Redis commands sent for blocked ReadOnly mutations, delta=%d", after-beforeCmdCount)
	}
}

func TestWritableKeyMutationsAndKeepTTLFallback(t *testing.T) {
	rejectKeepTTL := false
	var mu sync.Mutex
	srv, host, port := startMockRESPServer(t, func(_ *int, args []string) string {
		upper := strings.ToUpper(args[0])
		switch upper {
		case "SET":
			mu.Lock()
			legacy := rejectKeepTTL
			mu.Unlock()
			for _, a := range args[3:] {
				if strings.EqualFold(a, "KEEPTTL") && legacy {
					return "-ERR syntax error\r\n"
				}
			}
			return "+OK\r\n"
		case "PTTL":
			return respInt(45321)
		case "EXPIRE", "PERSIST", "HDEL", "HSET", "DEL":
			return respInt(1)
		default:
			return "+OK\r\n"
		}
	})

	svc := newTestRedisService(t.TempDir(), newFakeSecretStore())
	if err := svc.SaveConnection(Connection{
		ID:   "rw",
		Name: "Writable",
		Host: host,
		Port: port,
	}, ""); err != nil {
		t.Fatalf("SaveConnection: %v", err)
	}

	if err := svc.SetTTL("rw", 0, "session:1", 120); err != nil {
		t.Fatalf("SetTTL(120): %v", err)
	}
	if err := svc.SetTTL("rw", 0, "session:1", -1); err != nil {
		t.Fatalf("SetTTL(-1): %v", err)
	}
	if err := svc.HashDelete("rw", 0, "profile:1", "avatar"); err != nil {
		t.Fatalf("HashDelete: %v", err)
	}
	if err := svc.SetString("rw", 0, "greeting", "hello-redis-6"); err != nil {
		t.Fatalf("SetString KeepTTL: %v", err)
	}

	// Simulate Redis < 6.0 returning ERR syntax error on KEEPTTL -> falls back to PTTL + PX.
	mu.Lock()
	rejectKeepTTL = true
	mu.Unlock()
	if err := svc.SetString("rw", 0, "greeting", "hello-redis-5"); err != nil {
		t.Fatalf("SetString legacy fallback: %v", err)
	}

	cmds := srv.recordedCommands()
	var sawExpire, sawPersist, sawHDel, sawKeepTTL, sawFallbackPX bool
	for _, c := range cmds {
		joined := strings.ToUpper(strings.Join(c, " "))
		switch {
		case strings.HasPrefix(joined, "EXPIRE SESSION:1 120"):
			sawExpire = true
		case strings.HasPrefix(joined, "PERSIST SESSION:1"):
			sawPersist = true
		case strings.HasPrefix(joined, "HDEL PROFILE:1 AVATAR"):
			sawHDel = true
		case strings.Contains(joined, "HELLO-REDIS-6") && strings.Contains(joined, "KEEPTTL"):
			sawKeepTTL = true
		case strings.Contains(joined, "HELLO-REDIS-5") && strings.Contains(joined, "PX 45321"):
			sawFallbackPX = true
		}
	}
	if !sawExpire || !sawPersist || !sawHDel || !sawKeepTTL || !sawFallbackPX {
		t.Fatalf("missing expected Redis mutation commands: expire=%v persist=%v hdel=%v keepttl=%v fallbackPX=%v (cmds=%v)",
			sawExpire, sawPersist, sawHDel, sawKeepTTL, sawFallbackPX, cmds)
	}
}

func TestGetValueBigKeyProtection(t *testing.T) {
	bigChunk := strings.Repeat("x", maxStringLoadBytes)
	_, host, port := startMockRESPServer(t, func(_ *int, args []string) string {
		upper := strings.ToUpper(args[0])
		key := ""
		if len(args) > 1 {
			key = args[1]
		}
		switch upper {
		case "TYPE":
			switch key {
			case "big:str":
				return "+string\r\n"
			case "big:hash":
				return "+hash\r\n"
			case "big:set":
				return "+set\r\n"
			case "big:list":
				return "+list\r\n"
			case "big:zset":
				return "+zset\r\n"
			case "big:stream":
				return "+stream\r\n"
			}
		case "PTTL":
			return respInt(-1)
		case "MEMORY":
			return respInt(8192)
		case "OBJECT":
			return respBulk("raw")
		case "STRLEN":
			return respInt(maxStringLoadBytes + 1024)
		case "GETRANGE":
			return respBulk(bigChunk)
		case "HLEN":
			return respInt(2500)
		case "HSCAN":
			cursor, _ := strconv.Atoi(args[2])
			pairs := make([]string, 0, 2400)
			for i := 0; i < 1200; i++ {
				idx := cursor*1200 + i
				pairs = append(pairs, fmt.Sprintf("f-%d", idx), fmt.Sprintf("v-%d", idx))
			}
			next := "1"
			if cursor > 0 {
				next = "0"
			}
			return respArray(respBulk(next), respBulkArray(pairs))
		case "SCARD":
			return respInt(2600)
		case "SSCAN":
			cursor, _ := strconv.Atoi(args[2])
			members := make([]string, 0, 1200)
			for i := 0; i < 1200; i++ {
				idx := cursor*1200 + i
				members = append(members, fmt.Sprintf("m-%d", idx))
			}
			next := "1"
			if cursor > 0 {
				next = "0"
			}
			return respArray(respBulk(next), respBulkArray(members))
		case "LLEN":
			return respInt(3000)
		case "LRANGE":
			items := make([]string, maxCollectionItems)
			for i := 0; i < maxCollectionItems; i++ {
				items[i] = fmt.Sprintf("item-%d", i)
			}
			return respBulkArray(items)
		case "ZCARD":
			return respInt(2400)
		case "ZRANGE":
			flat := make([]string, 0, maxCollectionItems*2)
			for i := 0; i < maxCollectionItems; i++ {
				flat = append(flat, fmt.Sprintf("member-%d", i), strconv.Itoa(i))
			}
			return respBulkArray(flat)
		case "XLEN":
			return respInt(900)
		case "XRANGE":
			entries := make([]string, maxStreamItems)
			for i := 0; i < maxStreamItems; i++ {
				id := fmt.Sprintf("1700000000000-%d", i)
				entries[i] = respArray(respBulk(id), respBulkArray([]string{"event", "click"}))
			}
			return respArray(entries...)
		}
		return "+OK\r\n"
	})

	svc := newTestRedisService(t.TempDir(), newFakeSecretStore())
	if err := svc.SaveConnection(Connection{ID: "big", Name: "BigKeyTest", Host: host, Port: port}, ""); err != nil {
		t.Fatalf("SaveConnection: %v", err)
	}

	strVal, err := svc.GetValue("big", 0, "big:str")
	if err != nil {
		t.Fatalf("GetValue(big:str): %v", err)
	}
	if !strVal.Truncated || strVal.TotalCount != maxStringLoadBytes+1024 || len(strVal.StringValue) != maxStringLoadBytes {
		t.Fatalf("unexpected big string result: truncated=%v total=%d len=%d", strVal.Truncated, strVal.TotalCount, len(strVal.StringValue))
	}

	hashVal, err := svc.GetValue("big", 0, "big:hash")
	if err != nil {
		t.Fatalf("GetValue(big:hash): %v", err)
	}
	if !hashVal.Truncated || hashVal.TotalCount != 2500 || len(hashVal.Hash) != maxCollectionItems {
		t.Fatalf("unexpected big hash result: truncated=%v total=%d len=%d", hashVal.Truncated, hashVal.TotalCount, len(hashVal.Hash))
	}

	setVal, err := svc.GetValue("big", 0, "big:set")
	if err != nil {
		t.Fatalf("GetValue(big:set): %v", err)
	}
	if !setVal.Truncated || setVal.TotalCount != 2600 || len(setVal.Set) != maxCollectionItems {
		t.Fatalf("unexpected big set result: truncated=%v total=%d len=%d", setVal.Truncated, setVal.TotalCount, len(setVal.Set))
	}

	listVal, err := svc.GetValue("big", 0, "big:list")
	if err != nil {
		t.Fatalf("GetValue(big:list): %v", err)
	}
	if !listVal.Truncated || listVal.TotalCount != 3000 || len(listVal.List) != maxCollectionItems {
		t.Fatalf("unexpected big list result: truncated=%v total=%d len=%d", listVal.Truncated, listVal.TotalCount, len(listVal.List))
	}

	zsetVal, err := svc.GetValue("big", 0, "big:zset")
	if err != nil {
		t.Fatalf("GetValue(big:zset): %v", err)
	}
	if !zsetVal.Truncated || zsetVal.TotalCount != 2400 || len(zsetVal.ZSet) != maxCollectionItems {
		t.Fatalf("unexpected big zset result: truncated=%v total=%d len=%d", zsetVal.Truncated, zsetVal.TotalCount, len(zsetVal.ZSet))
	}

	streamVal, err := svc.GetValue("big", 0, "big:stream")
	if err != nil {
		t.Fatalf("GetValue(big:stream): %v", err)
	}
	if !streamVal.Truncated || streamVal.TotalCount != 900 || len(streamVal.Stream) != maxStreamItems {
		t.Fatalf("unexpected big stream result: truncated=%v total=%d len=%d", streamVal.Truncated, streamVal.TotalCount, len(streamVal.Stream))
	}
}

func TestIPv6NewRedisClientAndSafePerDBClientPool(t *testing.T) {
	for _, inputHost := range []string{"::1", "[::1]"} {
		rawClient, err := newRedisClient(connectionRecord{
			Connection: Connection{
				Host:          inputHost,
				Port:          6380,
				TLS:           true,
				TLSSkipVerify: true,
			},
		})
		if err != nil {
			t.Fatalf("newRedisClient(%q): %v", inputHost, err)
		}
		stdClient, ok := rawClient.(*redis.Client)
		if !ok {
			_ = rawClient.Close()
			t.Fatalf("expected *redis.Client for standalone mode")
		}
		opts := stdClient.Options()
		if opts.Addr != "[::1]:6380" {
			_ = rawClient.Close()
			t.Fatalf("Addr for host %q = %q, want [::1]:6380", inputHost, opts.Addr)
		}
		if opts.TLSConfig == nil || !opts.TLSConfig.InsecureSkipVerify || opts.TLSConfig.ServerName != "::1" {
			_ = rawClient.Close()
			t.Fatalf("unexpected TLSConfig for host %q: %+v", inputHost, opts.TLSConfig)
		}
		if opts.DialTimeout != 5*time.Second || opts.ReadTimeout != 15*time.Second || opts.WriteTimeout != 15*time.Second {
			_ = rawClient.Close()
			t.Fatalf("unexpected timeouts: dial=%v read=%v write=%v", opts.DialTimeout, opts.ReadTimeout, opts.WriteTimeout)
		}
		_ = rawClient.Close()
	}

	svc := newTestRedisService(t.TempDir(), newFakeSecretStore())
	if err := svc.SaveConnection(Connection{ID: "pool", Name: "Pool", Host: "127.0.0.1", Port: 6379}, ""); err != nil {
		t.Fatalf("SaveConnection: %v", err)
	}
	c0, err := svc.clientFor("pool", 0)
	if err != nil {
		t.Fatalf("clientFor db0: %v", err)
	}
	c1, err := svc.clientFor("pool", 1)
	if err != nil {
		t.Fatalf("clientFor db1: %v", err)
	}
	if c0 == c1 {
		t.Fatalf("expected distinct clients for db0 and db1")
	}
	c0Again, err := svc.clientFor("pool", 0)
	if err != nil || c0Again != c0 {
		t.Fatalf("expected db0 client to remain cached and open after switching to db1")
	}

	// Opening > maxCachedDBClientsPerConn DBs caps cached clients per connection at 8.
	for db := 2; db < 11; db++ {
		if _, err := svc.clientFor("pool", db); err != nil {
			t.Fatalf("clientFor db%d: %v", db, err)
		}
	}
	svc.mu.Lock()
	cachedCount := len(svc.clients)
	svc.mu.Unlock()
	if cachedCount != maxCachedDBClientsPerConn {
		t.Fatalf("cached DB client count = %d, want %d", cachedCount, maxCachedDBClientsPerConn)
	}

	if err := svc.DeleteConnection("pool"); err != nil {
		t.Fatalf("DeleteConnection: %v", err)
	}
	svc.mu.Lock()
	afterDeleteCount := len(svc.clients)
	svc.mu.Unlock()
	if afterDeleteCount != 0 {
		t.Fatalf("expected 0 cached clients after DeleteConnection, got %d", afterDeleteCount)
	}
}

func TestClusterScanPaginationAndMultiMasterAggregation(t *testing.T) {
	svc := newTestRedisService(t.TempDir(), newFakeSecretStore())

	// 3 shards: shard 0 is empty, shard 1 has 2 pages, shard 2 has 1 page.
	keys, cursor1, done1, err := svc.advanceClusterScan("cluster-1", 3, 0, func(shardIdx int, shardCursor uint64) ([]string, uint64, error) {
		switch shardIdx {
		case 0:
			return nil, 0, nil
		case 1:
			if shardCursor == 0 {
				return []string{"k1", "k2"}, 77, nil
			}
			return []string{"k3"}, 0, nil
		case 2:
			return []string{"k4"}, 0, nil
		default:
			return nil, 0, nil
		}
	})
	if err != nil || done1 || cursor1 == 0 || !reflect.DeepEqual(keys, []string{"k1", "k2"}) {
		t.Fatalf("step 1 = (%v, cursor=%d, done=%v, err=%v)", keys, cursor1, done1, err)
	}

	keys2, cursor2, done2, err := svc.advanceClusterScan("cluster-1", 3, cursor1, func(shardIdx int, shardCursor uint64) ([]string, uint64, error) {
		if shardIdx != 1 || shardCursor != 77 {
			t.Fatalf("unexpected shard state in step 2: shard=%d cursor=%d", shardIdx, shardCursor)
		}
		return []string{"k3"}, 0, nil
	})
	if err != nil || done2 || cursor2 == 0 || !reflect.DeepEqual(keys2, []string{"k3"}) {
		t.Fatalf("step 2 = (%v, cursor=%d, done=%v, err=%v)", keys2, cursor2, done2, err)
	}

	keys3, cursor3, done3, err := svc.advanceClusterScan("cluster-1", 3, cursor2, func(shardIdx int, shardCursor uint64) ([]string, uint64, error) {
		if shardIdx != 2 || shardCursor != 0 {
			t.Fatalf("unexpected shard state in step 3: shard=%d cursor=%d", shardIdx, shardCursor)
		}
		return []string{"k4"}, 0, nil
	})
	if err != nil || !done3 || cursor3 != 0 || !reflect.DeepEqual(keys3, []string{"k4"}) {
		t.Fatalf("step 3 = (%v, cursor=%d, done=%v, err=%v)", keys3, cursor3, done3, err)
	}

	if _, _, _, err := svc.advanceClusterScan("cluster-1", 3, 999999, func(int, uint64) ([]string, uint64, error) {
		return nil, 0, nil
	}); err == nil || !strings.Contains(err.Error(), "cluster scan cursor expired") {
		t.Fatalf("expected expired cursor error, got %v", err)
	}

	samples := []masterMonitorSample{
		{
			info: masterInfoSample{
				addr:      "10.0.0.1:7000",
				latencyMS: 1.5,
				fields: map[string]string{
					"redis_version":              "7.2.4",
					"redis_mode":                 "cluster",
					"role":                       "master",
					"instantaneous_ops_per_sec":  "400",
					"connected_clients":          "12",
					"blocked_clients":            "1",
					"used_memory":                "1048576",
					"maxmemory":                  "4194304",
					"keyspace_hits":              "1000",
					"keyspace_misses":            "50",
					"evicted_keys":               "2",
					"expired_keys":               "10",
					"total_net_input_bytes":      "5000",
					"total_net_output_bytes":     "8000",
					"total_connections_received": "100",
					"rejected_connections":       "0",
					"db0":                        "keys=100,expires=20,avg_ttl=10000",
					"cmdstat_get":                "calls=300,usec=600,usec_per_call=2.00,rejected_calls=0,failed_calls=0",
					"connected_slaves":           "1",
					"slave0":                     "ip=10.0.0.11,port=7000,state=online,lag=0,sync_in_progress=0",
				},
			},
			slowlog: []SlowlogEntry{{ID: 1, At: 100, DurationUS: 12000, Command: []string{"GET", "a"}, Client: "10.0.0.9:1111"}},
			clients: []RedisClient{{ID: 1, Addr: "10.0.0.9:1111", DB: 0, Command: "get"}},
		},
		{
			info: masterInfoSample{
				addr:      "10.0.0.2:7001",
				latencyMS: 3.2,
				fields: map[string]string{
					"redis_version":              "7.2.4",
					"redis_mode":                 "cluster",
					"role":                       "master",
					"instantaneous_ops_per_sec":  "600",
					"connected_clients":          "8",
					"blocked_clients":            "2",
					"used_memory":                "2097152",
					"maxmemory":                  "4194304",
					"keyspace_hits":              "2000",
					"keyspace_misses":            "150",
					"evicted_keys":               "3",
					"expired_keys":               "25",
					"total_net_input_bytes":      "7000",
					"total_net_output_bytes":     "9000",
					"total_connections_received": "200",
					"rejected_connections":       "1",
					"db0":                        "keys=250,expires=30,avg_ttl=20000",
					"cmdstat_get":                "calls=700,usec=2400,usec_per_call=3.43,rejected_calls=1,failed_calls=2",
					"connected_slaves":           "1",
					"slave0":                     "ip=10.0.0.12,port=7001,state=online,lag=1,sync_in_progress=0",
				},
			},
			slowlog: []SlowlogEntry{{ID: 1, At: 200, DurationUS: 15000, Command: []string{"HGETALL", "b"}, Client: "10.0.0.9:2222"}},
			clients: []RedisClient{{ID: 2, Addr: "10.0.0.9:2222", DB: 0, Command: "info"}},
		},
	}

	mon := aggregateClusterMonitor(samples, 1700000000000)
	ov := mon.Overview
	if ov.OpsPerSec != 1000 || ov.ConnectedClients != 20 || ov.UsedMemoryBytes != 3145728 || ov.MaxMemoryBytes != 8388608 {
		t.Fatalf("unexpected cluster overview totals: %+v", ov)
	}
	if ov.LatencyMS != 3.2 || ov.TotalKeys != 350 || len(ov.Keyspaces) != 1 || ov.Keyspaces[0].Expires != 50 {
		t.Fatalf("unexpected cluster latency/keyspace: %+v", ov)
	}
	if len(ov.Commands) != 1 || ov.Commands[0].Calls != 1000 || ov.Commands[0].Usec != 3000 || ov.Commands[0].UsecPerCall != 3 {
		t.Fatalf("unexpected merged commands: %+v", ov.Commands)
	}
	if ov.Info["keyspace_hits"] != "3000" || ov.Info["evicted_keys"] != "5" || ov.Info["rejected_connections"] != "1" {
		t.Fatalf("unexpected merged info counters: %+v", ov.Info)
	}
	if len(mon.Slowlog) != 2 || mon.Slowlog[0].At != 200 || !strings.Contains(mon.Slowlog[0].Client, "10.0.0.2:7001") {
		t.Fatalf("unexpected merged slowlog: %+v", mon.Slowlog)
	}
	if len(mon.Clients) != 2 || len(mon.Replication.Replicas) != 2 {
		t.Fatalf("unexpected merged clients/replicas: clients=%+v replicas=%+v", mon.Clients, mon.Replication.Replicas)
	}

	appInfo := (&AppService{}).GetAppInfo()
	if expectedDir, err := defaultConfigDir(); err == nil && appInfo.ConfigDir != expectedDir {
		t.Fatalf("AppInfo.ConfigDir = %q, want %q", appInfo.ConfigDir, expectedDir)
	}
}
