package main

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

type masterInfoSample struct {
	addr      string
	latencyMS float64
	fields    map[string]string
}

type masterMonitorSample struct {
	info    masterInfoSample
	slowlog []SlowlogEntry
	clients []RedisClient
}

// GetMetrics returns a lightweight INFO snapshot for the status bar.
func (s *RedisService) GetMetrics(connID string, db int) (ServerMetrics, error) {
	client, err := s.clientFor(connID, db)
	if err != nil {
		return ServerMetrics{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if cc, ok := client.(*redis.ClusterClient); ok {
		var mu sync.Mutex
		var samples []masterInfoSample
		if err := cc.ForEachMaster(ctx, func(mCtx context.Context, master *redis.Client) error {
			info, infoErr := master.Info(mCtx, "server", "stats", "clients", "memory", "keyspace").Result()
			if infoErr != nil {
				return infoErr
			}
			mu.Lock()
			samples = append(samples, masterInfoSample{
				addr:   master.Options().Addr,
				fields: parseInfo(info),
			})
			mu.Unlock()
			return nil
		}); err != nil {
			return ServerMetrics{}, err
		}
		sort.Slice(samples, func(i, j int) bool { return samples[i].addr < samples[j].addr })
		return aggregateClusterMetrics(samples), nil
	}

	info, err := client.Info(ctx, "server", "stats", "clients", "memory", "keyspace").Result()
	if err != nil {
		return ServerMetrics{}, err
	}
	return buildServerMetrics(parseInfo(info)), nil
}

func buildServerMetrics(fields map[string]string) ServerMetrics {
	metrics := ServerMetrics{
		RedisVersion:     fields["redis_version"],
		OpsPerSec:        parseFloat(fields["instantaneous_ops_per_sec"]),
		ConnectedClients: parseInt(fields["connected_clients"]),
		UsedMemoryBytes:  parseInt64(fields["used_memory"]),
	}
	if metrics.UsedMemoryBytes == 0 && fields["used_memory"] != "" {
		metrics.UsedMemoryBytes = int64(parseFloat(fields["used_memory"]))
	}
	for _, ks := range parseKeyspaces(fields) {
		metrics.KeyCount += ks.Keys
	}
	return metrics
}

func aggregateClusterMetrics(samples []masterInfoSample) ServerMetrics {
	if len(samples) == 0 {
		return ServerMetrics{}
	}
	result := ServerMetrics{
		RedisVersion: samples[0].fields["redis_version"],
	}
	for _, sample := range samples {
		m := buildServerMetrics(sample.fields)
		result.OpsPerSec += m.OpsPerSec
		result.ConnectedClients += m.ConnectedClients
		result.UsedMemoryBytes += m.UsedMemoryBytes
		result.KeyCount += m.KeyCount
		if result.RedisVersion == "" && m.RedisVersion != "" {
			result.RedisVersion = m.RedisVersion
		}
	}
	return result
}

// GetOverview reads one live snapshot for the selected Redis database.
func (s *RedisService) GetOverview(connID string, db int) (OverviewSnapshot, error) {
	client, err := s.clientFor(connID, db)
	if err != nil {
		return OverviewSnapshot{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if cc, ok := client.(*redis.ClusterClient); ok {
		var mu sync.Mutex
		var samples []masterInfoSample
		if err := cc.ForEachMaster(ctx, func(mCtx context.Context, master *redis.Client) error {
			start := time.Now()
			info, infoErr := master.Info(mCtx, "server", "stats", "clients", "memory", "keyspace", "commandstats", "replication").Result()
			if infoErr != nil {
				return infoErr
			}
			mu.Lock()
			samples = append(samples, masterInfoSample{
				addr:      master.Options().Addr,
				latencyMS: elapsedMS(start),
				fields:    parseInfo(info),
			})
			mu.Unlock()
			return nil
		}); err != nil {
			return OverviewSnapshot{}, err
		}
		sort.Slice(samples, func(i, j int) bool { return samples[i].addr < samples[j].addr })
		return aggregateClusterOverview(samples, time.Now().UnixMilli()), nil
	}

	start := time.Now()
	info, err := client.Info(ctx, "server", "stats", "clients", "memory", "keyspace", "commandstats", "replication").Result()
	if err != nil {
		return OverviewSnapshot{}, err
	}
	return buildOverviewSnapshot(parseInfo(info), elapsedMS(start), time.Now().UnixMilli()), nil
}

func buildOverviewSnapshot(fields map[string]string, latencyMS float64, atMs int64) OverviewSnapshot {
	snapshot := OverviewSnapshot{
		AtMs:             atMs,
		OpsPerSec:        parseFloat(fields["instantaneous_ops_per_sec"]),
		ConnectedClients: parseInt(fields["connected_clients"]),
		UsedMemoryBytes:  parseInt64(fields["used_memory"]),
		MaxMemoryBytes:   parseInt64(fields["maxmemory"]),
		LatencyMS:        latencyMS,
		Info:             fields,
	}
	snapshot.Keyspaces = parseKeyspaces(fields)
	for _, keyspace := range snapshot.Keyspaces {
		snapshot.TotalKeys += keyspace.Keys
	}
	snapshot.Commands = parseCommands(fields)
	return snapshot
}

var clusterSummedInfoCounters = []string{
	"blocked_clients",
	"used_memory",
	"total_net_input_bytes",
	"total_net_output_bytes",
	"evicted_keys",
	"expired_keys",
	"keyspace_hits",
	"keyspace_misses",
	"total_connections_received",
	"rejected_connections",
}

func aggregateClusterOverview(samples []masterInfoSample, atMs int64) OverviewSnapshot {
	if len(samples) == 0 {
		return OverviewSnapshot{
			AtMs:      atMs,
			Keyspaces: []KeyspaceSnapshot{},
			Commands:  []CommandSnapshot{},
			Info:      map[string]string{},
		}
	}

	mergedInfo := make(map[string]string, len(samples[0].fields)+8)
	for k, v := range samples[0].fields {
		if strings.HasPrefix(k, "db") {
			if _, err := strconv.Atoi(strings.TrimPrefix(k, "db")); err == nil {
				continue
			}
		}
		mergedInfo[k] = v
	}
	if mergedInfo["redis_mode"] == "" {
		mergedInfo["redis_mode"] = "cluster"
	}

	var opsPerSec float64
	var connectedClients int
	var usedMemoryBytes int64
	var sumMaxMemory int64
	allHaveMaxMemory := true
	var maxLatencyMS float64

	counterSums := make(map[string]int64, len(clusterSummedInfoCounters))
	type dbAgg struct {
		keys           int64
		expires        int64
		weightedTTLSum int64
	}
	keyspaceByDB := make(map[int]*dbAgg)
	commandsByName := make(map[string]*CommandSnapshot)

	for _, sample := range samples {
		opsPerSec += parseFloat(sample.fields["instantaneous_ops_per_sec"])
		connectedClients += parseInt(sample.fields["connected_clients"])
		usedMemoryBytes += parseInt64(sample.fields["used_memory"])

		mMax := parseInt64(sample.fields["maxmemory"])
		if mMax <= 0 {
			allHaveMaxMemory = false
		} else {
			sumMaxMemory += mMax
		}
		if sample.latencyMS > maxLatencyMS {
			maxLatencyMS = sample.latencyMS
		}

		for _, key := range clusterSummedInfoCounters {
			counterSums[key] += parseInt64(sample.fields[key])
		}

		for _, ks := range parseKeyspaces(sample.fields) {
			agg, exists := keyspaceByDB[ks.DB]
			if !exists {
				agg = &dbAgg{}
				keyspaceByDB[ks.DB] = agg
			}
			agg.keys += ks.Keys
			agg.expires += ks.Expires
			if ks.Expires > 0 && ks.AvgTTLMS > 0 {
				agg.weightedTTLSum += ks.Expires * ks.AvgTTLMS
			}
		}

		for _, cmd := range parseAllCommands(sample.fields) {
			agg, exists := commandsByName[cmd.Name]
			if !exists {
				cp := cmd
				commandsByName[cmd.Name] = &cp
			} else {
				agg.Calls += cmd.Calls
				agg.Usec += cmd.Usec
				agg.Rejected += cmd.Rejected
				agg.Failed += cmd.Failed
			}
		}
	}

	var maxMemoryBytes int64
	if allHaveMaxMemory {
		maxMemoryBytes = sumMaxMemory
	}

	mergedInfo["instantaneous_ops_per_sec"] = strconv.FormatFloat(opsPerSec, 'f', -1, 64)
	mergedInfo["connected_clients"] = strconv.Itoa(connectedClients)
	mergedInfo["maxmemory"] = strconv.FormatInt(maxMemoryBytes, 10)
	for _, key := range clusterSummedInfoCounters {
		mergedInfo[key] = strconv.FormatInt(counterSums[key], 10)
	}

	keyspaces := make([]KeyspaceSnapshot, 0, len(keyspaceByDB))
	var totalKeys int64
	for dbIdx, agg := range keyspaceByDB {
		var avgTTL int64
		if agg.expires > 0 {
			avgTTL = agg.weightedTTLSum / agg.expires
		}
		keyspaces = append(keyspaces, KeyspaceSnapshot{
			DB:       dbIdx,
			Keys:     agg.keys,
			Expires:  agg.expires,
			AvgTTLMS: avgTTL,
		})
		totalKeys += agg.keys
	}
	sort.Slice(keyspaces, func(i, j int) bool { return keyspaces[i].DB < keyspaces[j].DB })
	for _, ks := range keyspaces {
		mergedInfo[fmt.Sprintf("db%d", ks.DB)] = fmt.Sprintf("keys=%d,expires=%d,avg_ttl=%d", ks.Keys, ks.Expires, ks.AvgTTLMS)
	}

	commands := make([]CommandSnapshot, 0, len(commandsByName))
	for _, cmd := range commandsByName {
		if cmd.Calls > 0 {
			cmd.UsecPerCall = math.Round((float64(cmd.Usec)/float64(cmd.Calls))*100) / 100
		} else {
			cmd.UsecPerCall = 0
		}
		commands = append(commands, *cmd)
	}
	commands = sortAndCapCommands(commands, 20)

	return OverviewSnapshot{
		AtMs:             atMs,
		OpsPerSec:        opsPerSec,
		ConnectedClients: connectedClients,
		UsedMemoryBytes:  usedMemoryBytes,
		MaxMemoryBytes:   maxMemoryBytes,
		LatencyMS:        maxLatencyMS,
		TotalKeys:        totalKeys,
		Keyspaces:        keyspaces,
		Commands:         commands,
		Info:             mergedInfo,
	}
}

// GetMonitorSnapshot collects the live monitor tables used by the UI.
func (s *RedisService) GetMonitorSnapshot(connID string, db int) (MonitorSnapshot, error) {
	client, err := s.clientFor(connID, db)
	if err != nil {
		return MonitorSnapshot{}, err
	}

	if cc, ok := client.(*redis.ClusterClient); ok {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		var mu sync.Mutex
		var samples []masterMonitorSample
		if err := cc.ForEachMaster(ctx, func(mCtx context.Context, master *redis.Client) error {
			start := time.Now()
			info, infoErr := master.Info(mCtx, "server", "stats", "clients", "memory", "keyspace", "commandstats", "replication").Result()
			if infoErr != nil {
				return infoErr
			}
			sample := masterMonitorSample{
				info: masterInfoSample{
					addr:      master.Options().Addr,
					latencyMS: elapsedMS(start),
					fields:    parseInfo(info),
				},
			}
			if raw, rawErr := master.Do(mCtx, "SLOWLOG", "GET", 20).Result(); rawErr == nil {
				sample.slowlog = parseSlowlog(raw)
			}
			if raw, rawErr := master.Do(mCtx, "CLIENT", "LIST").Result(); rawErr == nil {
				sample.clients = parseClients(fmt.Sprint(raw))
			}
			mu.Lock()
			samples = append(samples, sample)
			mu.Unlock()
			return nil
		}); err != nil {
			return MonitorSnapshot{}, err
		}
		sort.Slice(samples, func(i, j int) bool { return samples[i].info.addr < samples[j].info.addr })
		return aggregateClusterMonitor(samples, time.Now().UnixMilli()), nil
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

func aggregateClusterMonitor(samples []masterMonitorSample, atMs int64) MonitorSnapshot {
	infoSamples := make([]masterInfoSample, 0, len(samples))
	var mergedSlowlog []SlowlogEntry
	var mergedClients []RedisClient
	var mergedReplicas []ReplicaSnapshot

	for _, sample := range samples {
		infoSamples = append(infoSamples, sample.info)
		addr := sample.info.addr

		for _, entry := range sample.slowlog {
			if entry.Client != "" {
				entry.Client = fmt.Sprintf("[%s] %s", addr, entry.Client)
			} else {
				entry.Client = addr
			}
			mergedSlowlog = append(mergedSlowlog, entry)
		}

		for _, c := range sample.clients {
			if c.Addr != "" {
				c.Addr = fmt.Sprintf("[%s] %s", addr, c.Addr)
			} else {
				c.Addr = addr
			}
			mergedClients = append(mergedClients, c)
		}

		rep := parseReplication(sample.info.fields)
		for _, replica := range rep.Replicas {
			replica.ID = int64(len(mergedReplicas))
			mergedReplicas = append(mergedReplicas, replica)
		}
	}

	sort.Slice(mergedSlowlog, func(i, j int) bool {
		if mergedSlowlog[i].At != mergedSlowlog[j].At {
			return mergedSlowlog[i].At > mergedSlowlog[j].At
		}
		if mergedSlowlog[i].DurationUS != mergedSlowlog[j].DurationUS {
			return mergedSlowlog[i].DurationUS > mergedSlowlog[j].DurationUS
		}
		return mergedSlowlog[i].ID > mergedSlowlog[j].ID
	})
	if len(mergedSlowlog) > 20 {
		mergedSlowlog = mergedSlowlog[:20]
	}

	overview := aggregateClusterOverview(infoSamples, atMs)
	replication := parseReplication(overview.Info)
	replication.Replicas = mergedReplicas

	return MonitorSnapshot{
		Overview:    overview,
		Slowlog:     mergedSlowlog,
		Clients:     mergedClients,
		Replication: replication,
	}
}
