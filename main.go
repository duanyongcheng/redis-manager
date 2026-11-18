package main

import (
	"log"
	"sync"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/updater"
	"github.com/redis/go-redis/v9"
)

// RedisService owns saved connections and lazily creates Redis clients.
type RedisService struct {
	mu                sync.Mutex
	loaded            bool
	credentialStorage string
	localKey          []byte
	records           map[string]connectionRecord
	passwords         map[string]string
	clients           map[clientKey]redis.UniversalClient
	clientOrder       []clientKey
	clusterScans      map[uint64]clusterScanCursor
	scanTokenOrder    []uint64
	nextScanToken     uint64
	configDirFn       func() (string, error)
	secrets           secretStore
}

func NewRedisService() *RedisService {
	return &RedisService{
		credentialStorage: CredentialStorageLocal,
		records:           make(map[string]connectionRecord),
		passwords:         make(map[string]string),
		clients:           make(map[clientKey]redis.UniversalClient),
		clusterScans:      make(map[uint64]clusterScanCursor),
		configDirFn:       defaultConfigDir,
		secrets:           mygoSecretStore{},
	}
}

func main() {
	mygo.Use(updater.New(updater.Options{Language: "zh-Hans"}))
	mygo.Bind(&AppService{})
	service := NewRedisService()
	mygo.Bind(service)
	mygo.App.WhenReady(func() {
		mygo.NewWindow(mygo.WindowOptions{
			Title:           appName,
			Width:           1440,
			Height:          900,
			MinWidth:        1040,
			MinHeight:       680,
			BackgroundColor: "#fbfbfc",
			StateKey:        "main",
			URL:             "/",
		})
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
