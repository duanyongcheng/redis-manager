package main

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// ExecCLI executes one command and returns terminal-friendly output lines.
func (s *RedisService) ExecCLI(connID string, db int, line string, readOnly bool) (CLIResult, error) {
	args, err := splitCommand(line)
	if err != nil {
		return CLIResult{}, err
	}
	if len(args) == 0 {
		return CLIResult{}, errors.New("command is empty")
	}
	if msg := interceptedCommandMessage(args); msg != "" {
		return CLIResult{Lines: []CLILine{{Kind: "error", Text: msg}}}, nil
	}

	connReadOnly, connErr := s.isConnectionReadOnly(connID)
	if connErr != nil && !readOnly {
		return CLIResult{}, connErr
	}
	effectiveReadOnly := readOnly || connReadOnly
	if effectiveReadOnly && isWriteOrMutatingCommand(args) {
		label := formatBlockedCommandLabel(args)
		if connReadOnly {
			return CLIResult{Lines: []CLILine{{Kind: "error", Text: fmt.Sprintf("当前连接为只读模式，已拦截 %s 命令。", label)}}}, nil
		}
		return CLIResult{Lines: []CLILine{{Kind: "error", Text: fmt.Sprintf("只读模式已拦截 %s 命令，请切换到可写模式后重试。", label)}}}, nil
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
	if errors.Is(err, redis.Nil) {
		return CLIResult{Lines: formatCLIResult(nil), DurationMS: elapsedMS(start)}, nil
	}
	if err != nil {
		return CLIResult{Lines: []CLILine{{Kind: "error", Text: err.Error()}}, DurationMS: elapsedMS(start)}, nil
	}
	return CLIResult{Lines: formatCLIResult(result), DurationMS: elapsedMS(start)}, nil
}

func interceptedCommandMessage(args []string) string {
	if len(args) == 0 {
		return ""
	}
	switch strings.ToLower(strings.TrimSpace(args[0])) {
	case "keys":
		return "KEYS 可能阻塞实例，请使用 SCAN 0 MATCH ... COUNT 200。"
	case "monitor":
		return "MONITOR 会独占连接并持续拉高服务端负载，请使用「监控」视图查看实时吞吐与慢查询。"
	case "select":
		return "不支持在 CLI 中直接执行 SELECT，请使用顶部数据库选择器切换 DB，避免污染连接池状态。"
	case "shutdown":
		return "已拦截高危命令 SHUTDOWN。"
	case "debug":
		return "已拦截高危命令 DEBUG。"
	default:
		return ""
	}
}

func formatBlockedCommandLabel(args []string) string {
	if len(args) == 0 {
		return ""
	}
	cmd := strings.ToLower(strings.TrimSpace(args[0]))
	if len(args) > 1 && subcommandGuardedCommands[cmd] {
		return strings.ToUpper(cmd + " " + strings.TrimSpace(args[1]))
	}
	return strings.ToUpper(cmd)
}

var subcommandGuardedCommands = map[string]bool{
	"config":   true,
	"client":   true,
	"slowlog":  true,
	"memory":   true,
	"cluster":  true,
	"acl":      true,
	"function": true,
	"pubsub":   true,
	"xinfo":    true,
	"object":   true,
	"latency":  true,
	"module":   true,
}

func isWriteOrMutatingCommand(args []string) bool {
	if len(args) == 0 {
		return false
	}
	cmd := strings.ToLower(strings.TrimSpace(args[0]))
	sub := ""
	if len(args) > 1 {
		sub = strings.ToLower(strings.TrimSpace(args[1]))
	}

	switch cmd {
	case "config":
		return sub != "get" && sub != "help"
	case "client":
		switch sub {
		case "list", "getname", "id", "info", "getredir", "help":
			return false
		default:
			return true
		}
	case "slowlog":
		switch sub {
		case "get", "len", "help":
			return false
		default:
			return true
		}
	case "memory":
		switch sub {
		case "usage", "stats", "doctor", "malloc-stats", "help":
			return false
		default:
			return true
		}
	case "cluster":
		switch sub {
		case "info", "nodes", "slots", "shards", "keyslot", "countkeysinslot", "getkeysinslot",
			"myid", "myshardid", "links", "replicas", "slaves", "count-failure-reports", "help":
			return false
		default:
			return true
		}
	case "acl":
		if sub == "log" && len(args) > 2 && strings.EqualFold(strings.TrimSpace(args[2]), "reset") {
			return true
		}
		switch sub {
		case "whoami", "list", "users", "getuser", "cat", "log", "dryrun", "genpass", "help":
			return false
		default:
			return true
		}
	case "function":
		switch sub {
		case "list", "dump", "stats", "help":
			return false
		default:
			return true
		}
	case "pubsub":
		switch sub {
		case "channels", "numsub", "numpat", "shardchannels", "shardnumsub", "help":
			return false
		default:
			return true
		}
	case "xinfo":
		switch sub {
		case "stream", "groups", "consumers", "help":
			return false
		default:
			return true
		}
	case "object":
		switch sub {
		case "encoding", "freq", "idletime", "refcount", "help":
			return false
		default:
			return true
		}
	case "latency":
		return sub == "reset"
	case "module":
		return sub != "list" && sub != "help"
	case "georadius", "georadiusbymember":
		return hasAnyArgFold(args[1:], "store", "storedist")
	case "sort":
		return hasAnyArgFold(args[1:], "store")
	}

	return writeCommands[cmd]
}

func hasAnyArgFold(args []string, targets ...string) bool {
	for _, arg := range args {
		trimmed := strings.TrimSpace(arg)
		for _, target := range targets {
			if strings.EqualFold(trimmed, target) {
				return true
			}
		}
	}
	return false
}

var writeCommands = map[string]bool{
	// Strings
	"set":         true,
	"setnx":       true,
	"setex":       true,
	"psetex":      true,
	"setrange":    true,
	"setbit":      true,
	"getset":      true,
	"getdel":      true,
	"getex":       true,
	"mset":        true,
	"msetnx":      true,
	"msetex":      true,
	"append":      true,
	"incr":        true,
	"incrby":      true,
	"incrbyfloat": true,
	"decr":        true,
	"decrby":      true,
	"delex":       true,

	// Generic / Keyspace / DB
	"del":            true,
	"unlink":         true,
	"expire":         true,
	"pexpire":        true,
	"expireat":       true,
	"pexpireat":      true,
	"persist":        true,
	"rename":         true,
	"renamenx":       true,
	"copy":           true,
	"move":           true,
	"restore":        true,
	"restore-asking": true,
	"migrate":        true,
	"flushdb":        true,
	"flushall":       true,
	"swapdb":         true,

	// Hashes
	"hset":         true,
	"hsetnx":       true,
	"hmset":        true,
	"hdel":         true,
	"hincrby":      true,
	"hincrbyfloat": true,
	"hexpire":      true,
	"hpexpire":     true,
	"hexpireat":    true,
	"hpexpireat":   true,
	"hpersist":     true,
	"hgetdel":      true,
	"hgetex":       true,
	"hsetex":       true,

	// Lists
	"lpush":      true,
	"lpushx":     true,
	"rpush":      true,
	"rpushx":     true,
	"lpop":       true,
	"rpop":       true,
	"blpop":      true,
	"brpop":      true,
	"rpoplpush":  true,
	"brpoplpush": true,
	"lmove":      true,
	"blmove":     true,
	"lmpop":      true,
	"blmpop":     true,
	"lset":       true,
	"linsert":    true,
	"lrem":       true,
	"ltrim":      true,

	// Sets
	"sadd":        true,
	"srem":        true,
	"spop":        true,
	"smove":       true,
	"sinterstore": true,
	"sunionstore": true,
	"sdiffstore":  true,

	// Sorted Sets
	"zadd":             true,
	"zrem":             true,
	"zincrby":          true,
	"zpopmin":          true,
	"zpopmax":          true,
	"bzpopmin":         true,
	"bzpopmax":         true,
	"zmpop":            true,
	"bzmpop":           true,
	"zremrangebyrank":  true,
	"zremrangebyscore": true,
	"zremrangebylex":   true,
	"zrangestore":      true,
	"zinterstore":      true,
	"zunionstore":      true,
	"zdiffstore":       true,

	// Streams
	"xadd":       true,
	"xdel":       true,
	"xdelex":     true,
	"xackdel":    true,
	"xtrim":      true,
	"xack":       true,
	"xclaim":     true,
	"xautoclaim": true,
	"xgroup":     true,
	"xsetid":     true,

	// HyperLogLog / Bitmap / Geo
	"pfadd":          true,
	"pfmerge":        true,
	"pfdebug":        true,
	"bitop":          true,
	"bitfield":       true,
	"geoadd":         true,
	"geosearchstore": true,

	// Scripting / Functions
	"eval":    true,
	"evalsha": true,
	"fcall":   true,
	"script":  true,

	// Pub/Sub
	"publish":  true,
	"spublish": true,

	// Server / Persistence / Replication / Connection
	"bgrewriteaof": true,
	"bgsave":       true,
	"save":         true,
	"replicaof":    true,
	"slaveof":      true,
	"failover":     true,
	"auth":         true,
	"select":       true,
	"shutdown":     true,
	"debug":        true,
	"monitor":      true,
	"multi":        true,
	"exec":         true,
	"discard":      true,
	"watch":        true,
	"unwatch":      true,
	"reset":        true,
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
	case map[any]any:
		keys := make([]string, 0, len(item))
		byKey := make(map[string]any, len(item))
		for k, v := range item {
			ks := anyString(k)
			keys = append(keys, ks)
			byKey[ks] = v
		}
		sort.Strings(keys)
		flat := make([]any, 0, len(keys)*2)
		for _, ks := range keys {
			flat = append(flat, ks, byKey[ks])
		}
		return formatCLIResult(flat)
	case map[string]string:
		keys := make([]string, 0, len(item))
		for k := range item {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		flat := make([]string, 0, len(keys)*2)
		for _, k := range keys {
			flat = append(flat, k, item[k])
		}
		return formatCLIResult(flat)
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
