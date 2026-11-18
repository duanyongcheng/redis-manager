package main

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

func (s *RedisService) storeClusterScanCursor(cursor clusterScanCursor) uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureMapsLocked()
	s.nextScanToken++
	if s.nextScanToken == 0 {
		s.nextScanToken = 1
	}
	token := s.nextScanToken
	for len(s.scanTokenOrder) >= maxClusterScanCursors {
		oldest := s.scanTokenOrder[0]
		s.scanTokenOrder = s.scanTokenOrder[1:]
		delete(s.clusterScans, oldest)
	}
	s.clusterScans[token] = cursor
	s.scanTokenOrder = append(s.scanTokenOrder, token)
	return token
}

func (s *RedisService) lookupClusterScanCursor(connID string, token uint64) (clusterScanCursor, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.clusterScans == nil {
		return clusterScanCursor{}, false
	}
	cursor, ok := s.clusterScans[token]
	if !ok || cursor.connID != connID {
		return clusterScanCursor{}, false
	}
	return cursor, true
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

	if cc, ok := client.(*redis.ClusterClient); ok {
		return s.scanClusterKeys(ctx, connID, cc, pattern, cursor, count)
	}

	keys, next, err := client.Scan(ctx, cursor, pattern, int64(count)).Result()
	if err != nil {
		return KeyPage{}, err
	}
	page := KeyPage{Cursor: next, Done: next == 0, Keys: enrichKeyMetadata(ctx, client, keys)}
	return page, nil
}

func (s *RedisService) scanClusterKeys(
	ctx context.Context,
	connID string,
	cc *redis.ClusterClient,
	pattern string,
	cursor uint64,
	count int,
) (KeyPage, error) {
	var mastersMu sync.Mutex
	var masters []*redis.Client
	if err := cc.ForEachMaster(ctx, func(_ context.Context, master *redis.Client) error {
		mastersMu.Lock()
		masters = append(masters, master)
		mastersMu.Unlock()
		return nil
	}); err != nil {
		return KeyPage{}, err
	}
	sort.Slice(masters, func(i, j int) bool {
		return masters[i].Options().Addr < masters[j].Options().Addr
	})

	scanFn := func(shardIdx int, shardCursor uint64) ([]string, uint64, error) {
		return masters[shardIdx].Scan(ctx, shardCursor, pattern, int64(count)).Result()
	}
	keys, nextToken, done, err := s.advanceClusterScan(connID, len(masters), cursor, scanFn)
	if err != nil {
		return KeyPage{}, err
	}
	return KeyPage{
		Keys:   enrichKeyMetadata(ctx, cc, keys),
		Cursor: nextToken,
		Done:   done,
	}, nil
}

func (s *RedisService) advanceClusterScan(
	connID string,
	masterCount int,
	cursor uint64,
	scanShard func(shardIdx int, shardCursor uint64) ([]string, uint64, error),
) ([]string, uint64, bool, error) {
	if masterCount == 0 {
		return []string{}, 0, true, nil
	}
	shardIdx := 0
	var shardCursor uint64
	if cursor > 0 {
		state, ok := s.lookupClusterScanCursor(connID, cursor)
		if !ok {
			return nil, 0, false, errors.New("cluster scan cursor expired, please rescan")
		}
		shardIdx = state.shardIdx
		shardCursor = state.shardCursor
		if shardIdx < 0 || shardIdx >= masterCount {
			return []string{}, 0, true, nil
		}
	}

	var collected []string
	for shardIdx < masterCount {
		batch, nextShardCursor, err := scanShard(shardIdx, shardCursor)
		if err != nil {
			return nil, 0, false, err
		}
		collected = append(collected, batch...)
		if nextShardCursor != 0 {
			nextToken := s.storeClusterScanCursor(clusterScanCursor{
				connID:      connID,
				shardIdx:    shardIdx,
				shardCursor: nextShardCursor,
			})
			return collected, nextToken, false, nil
		}
		shardIdx++
		shardCursor = 0
		if shardIdx >= masterCount {
			return collected, 0, true, nil
		}
		if len(collected) > 0 {
			nextToken := s.storeClusterScanCursor(clusterScanCursor{
				connID:      connID,
				shardIdx:    shardIdx,
				shardCursor: 0,
			})
			return collected, nextToken, false, nil
		}
	}
	return collected, 0, true, nil
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

// GetValue reads a key and returns a type-specific value representation with
// big-key protection caps.
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
		strLen, lenErr := client.StrLen(ctx, key).Result()
		if lenErr != nil {
			err = lenErr
			break
		}
		value.TotalCount = strLen
		if strLen > maxStringLoadBytes {
			value.StringValue, err = client.GetRange(ctx, key, 0, maxStringLoadBytes-1).Result()
			value.Truncated = true
		} else {
			value.StringValue, err = client.Get(ctx, key).Result()
		}
	case "hash":
		hlen, lenErr := client.HLen(ctx, key).Result()
		if lenErr != nil {
			err = lenErr
			break
		}
		value.TotalCount = hlen
		if hlen <= maxCollectionItems {
			value.Hash, err = client.HGetAll(ctx, key).Result()
			if err == nil && int64(len(value.Hash)) > maxCollectionItems {
				trimmed := make(map[string]string, maxCollectionItems)
				for k, v := range value.Hash {
					trimmed[k] = v
					if len(trimmed) >= maxCollectionItems {
						break
					}
				}
				value.Hash = trimmed
				value.Truncated = true
			}
		} else {
			hash := make(map[string]string, maxCollectionItems)
			var scanCursor uint64
			for len(hash) < maxCollectionItems {
				pairs, nextCursor, scanErr := client.HScan(ctx, key, scanCursor, "", 500).Result()
				if scanErr != nil {
					err = scanErr
					break
				}
				for i := 0; i+1 < len(pairs); i += 2 {
					field := pairs[i]
					if _, exists := hash[field]; !exists && len(hash) >= maxCollectionItems {
						break
					}
					hash[field] = pairs[i+1]
				}
				scanCursor = nextCursor
				if scanCursor == 0 {
					break
				}
			}
			if err == nil {
				value.Hash = hash
				value.Truncated = int64(len(hash)) < hlen
			}
		}
	case "list":
		llen, lenErr := client.LLen(ctx, key).Result()
		if lenErr != nil {
			err = lenErr
			break
		}
		value.TotalCount = llen
		value.List, err = client.LRange(ctx, key, 0, maxCollectionItems-1).Result()
		if err == nil {
			value.Truncated = llen > int64(len(value.List))
		}
	case "set":
		scard, cardErr := client.SCard(ctx, key).Result()
		if cardErr != nil {
			err = cardErr
			break
		}
		value.TotalCount = scard
		if scard <= maxCollectionItems {
			value.Set, err = client.SMembers(ctx, key).Result()
			if err == nil && len(value.Set) > maxCollectionItems {
				value.Set = value.Set[:maxCollectionItems]
				value.Truncated = true
			}
		} else {
			seen := make(map[string]struct{}, maxCollectionItems)
			members := make([]string, 0, maxCollectionItems)
			var scanCursor uint64
			for len(members) < maxCollectionItems {
				batch, nextCursor, scanErr := client.SScan(ctx, key, scanCursor, "", 500).Result()
				if scanErr != nil {
					err = scanErr
					break
				}
				for _, member := range batch {
					if _, exists := seen[member]; exists {
						continue
					}
					seen[member] = struct{}{}
					members = append(members, member)
					if len(members) >= maxCollectionItems {
						break
					}
				}
				scanCursor = nextCursor
				if scanCursor == 0 {
					break
				}
			}
			if err == nil {
				value.Set = members
				value.Truncated = int64(len(members)) < scard
			}
		}
	case "zset":
		zcard, cardErr := client.ZCard(ctx, key).Result()
		if cardErr != nil {
			err = cardErr
			break
		}
		value.TotalCount = zcard
		items, zErr := client.ZRangeWithScores(ctx, key, 0, maxCollectionItems-1).Result()
		err = zErr
		if err == nil {
			value.ZSet = make([]ZSetEntry, 0, len(items))
			for _, item := range items {
				value.ZSet = append(value.ZSet, ZSetEntry{Member: fmt.Sprint(item.Member), Score: item.Score})
			}
			value.Truncated = zcard > int64(len(value.ZSet))
		}
	case "stream":
		xlen, lenErr := client.XLen(ctx, key).Result()
		if lenErr != nil {
			err = lenErr
			break
		}
		value.TotalCount = xlen
		items, xErr := client.XRangeN(ctx, key, "-", "+", maxStreamItems).Result()
		err = xErr
		if err == nil {
			value.Stream = make([]StreamEntry, 0, len(items))
			for _, item := range items {
				fields := make(map[string]string, len(item.Values))
				for field, fieldValue := range item.Values {
					fields[field] = fmt.Sprint(fieldValue)
				}
				value.Stream = append(value.Stream, StreamEntry{ID: item.ID, Values: fields})
			}
			value.Truncated = xlen > int64(len(value.Stream))
		}
	default:
		err = fmt.Errorf("unsupported redis type %q", typ)
	}
	if err != nil {
		return RedisValue{}, err
	}
	return value, nil
}

func (s *RedisService) ensureConnectionWritable(connID string) error {
	readOnly, err := s.isConnectionReadOnly(connID)
	if err != nil {
		return err
	}
	if readOnly {
		return errors.New(readOnlyConnectionErrText)
	}
	return nil
}

// DeleteKey deletes one key after the frontend's confirmation step.
func (s *RedisService) DeleteKey(connID string, db int, key string) error {
	if err := s.ensureConnectionWritable(connID); err != nil {
		return err
	}
	if key == "" {
		return errors.New("key is required")
	}
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
	if err := s.ensureConnectionWritable(connID); err != nil {
		return err
	}
	if key == "" {
		return errors.New("key is required")
	}
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

// HashDelete deletes one field from a hash.
func (s *RedisService) HashDelete(connID string, db int, key, field string) error {
	if err := s.ensureConnectionWritable(connID); err != nil {
		return err
	}
	if key == "" {
		return errors.New("key is required")
	}
	if field == "" {
		return errors.New("hash field is required")
	}
	client, err := s.clientFor(connID, db)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return client.HDel(ctx, key, field).Err()
}

// SetTTL updates or removes expiration on a key.
func (s *RedisService) SetTTL(connID string, db int, key string, ttlSeconds int64) error {
	if err := s.ensureConnectionWritable(connID); err != nil {
		return err
	}
	if key == "" {
		return errors.New("key is required")
	}
	client, err := s.clientFor(connID, db)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if ttlSeconds < 0 {
		return client.Persist(ctx, key).Err()
	}
	return client.Expire(ctx, key, time.Duration(ttlSeconds)*time.Second).Err()
}

// SetString sets a string value while preserving any existing TTL.
func (s *RedisService) SetString(connID string, db int, key, value string) error {
	if err := s.ensureConnectionWritable(connID); err != nil {
		return err
	}
	if key == "" {
		return errors.New("key is required")
	}
	client, err := s.clientFor(connID, db)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err = client.Set(ctx, key, value, redis.KeepTTL).Err()
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "syntax error") {
		pttl, pttlErr := client.PTTL(ctx, key).Result()
		if pttlErr == nil && pttl > 0 {
			return client.Set(ctx, key, value, pttl).Err()
		}
		return client.Set(ctx, key, value, 0).Err()
	}
	return err
}
