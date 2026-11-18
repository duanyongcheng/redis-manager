package main

import (
	"fmt"
	"net"
	"sort"
	"strconv"
	"strings"
	"time"
)

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
			DB:       db,
			Keys:     parseInt64(metrics["keys"]),
			Expires:  parseInt64(metrics["expires"]),
			AvgTTLMS: parseInt64(metrics["avg_ttl"]),
		})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].DB < result[j].DB })
	return result
}

func parseAllCommands(fields map[string]string) []CommandSnapshot {
	result := make([]CommandSnapshot, 0)
	for key, value := range fields {
		if !strings.HasPrefix(key, "cmdstat_") {
			continue
		}
		metrics := parseMetricList(value)
		name := strings.TrimPrefix(key, "cmdstat_")
		result = append(result, CommandSnapshot{
			Name:        name,
			Calls:       parseInt64(metrics["calls"]),
			Usec:        parseInt64(metrics["usec"]),
			UsecPerCall: parseFloat(metrics["usec_per_call"]),
			Rejected:    parseInt64(metrics["rejected_calls"]),
			Failed:      parseInt64(metrics["failed_calls"]),
		})
	}
	return result
}

func sortAndCapCommands(commands []CommandSnapshot, limit int) []CommandSnapshot {
	sort.Slice(commands, func(i, j int) bool {
		if commands[i].Calls == commands[j].Calls {
			return commands[i].Name < commands[j].Name
		}
		return commands[i].Calls > commands[j].Calls
	})
	if limit > 0 && len(commands) > limit {
		return commands[:limit]
	}
	return commands
}

func parseCommands(fields map[string]string) []CommandSnapshot {
	return sortAndCapCommands(parseAllCommands(fields), 20)
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
		Role:       fields["role"],
		MasterHost: fields["master_host"],
		MasterPort: parseInt(fields["master_port"]),
		MasterLink: fields["master_link_status"],
		Replicas:   make([]ReplicaSnapshot, 0),
	}
	count := parseInt(fields["connected_slaves"])
	for index := 0; index < count; index++ {
		metrics := parseMetricList(fields[fmt.Sprintf("slave%d", index)])
		result.Replicas = append(result.Replicas, ReplicaSnapshot{
			ID:             int64(index),
			Addr:           netAddress(metrics["ip"], metrics["port"]),
			State:          metrics["state"],
			Lag:            parseInt64(metrics["lag"]),
			SyncInProgress: metrics["sync_in_progress"] == "1",
		})
	}
	return result
}

func netAddress(host, port string) string {
	host = stripHostBrackets(host)
	port = strings.TrimSpace(port)
	if host == "" {
		return ""
	}
	if port == "" {
		return host
	}
	return net.JoinHostPort(host, port)
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
		entry := SlowlogEntry{
			ID:         anyInt64(row[0]),
			At:         anyInt64(row[1]),
			DurationUS: anyInt64(row[2]),
			Command:    anyStrings(row[3]),
		}
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
			ID:      parseInt64(fields["id"]),
			Addr:    fields["addr"],
			Name:    fields["name"],
			Age:     parseInt64(fields["age"]),
			Idle:    parseInt64(fields["idle"]),
			DB:      parseInt(fields["db"]),
			Command: fields["cmd"],
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
