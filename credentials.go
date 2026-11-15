package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/egoist/mygo"
)

const (
	CredentialStorageLocal    = "local"
	CredentialStorageKeychain = "keychain"

	credentialStoreNone     = "none"
	credentialStoreLocal    = "local"
	credentialStoreKeychain = "keychain"

	encryptedPasswordPrefix = "v1:"
	localKeyByteLen         = 32
)

// CredentialStorageStatus describes the active credential backend and whether
// any legacy connection passwords still reside in the OS keychain.
type CredentialStorageStatus struct {
	Mode            string `json:"mode"`
	KeychainPending int    `json:"keychainPending"`
}

type appPreferences struct {
	CredentialStorage string `json:"credentialStorage"`
}

type secretStore interface {
	Get(key string) ([]byte, error)
	Set(key string, value []byte) error
	Delete(key string) error
}

type mygoSecretStore struct{}

func (mygoSecretStore) Get(key string) ([]byte, error) {
	return mygo.Secrets.Service(appName).Get(key)
}

func (mygoSecretStore) Set(key string, value []byte) error {
	return mygo.Secrets.Service(appName).Set(key, value)
}

func (mygoSecretStore) Delete(key string) error {
	return mygo.Secrets.Service(appName).Delete(key)
}

func defaultConfigDir() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, appName), nil
}

func (s *RedisService) configDir() (string, error) {
	if s.configDirFn != nil {
		return s.configDirFn()
	}
	return defaultConfigDir()
}

func (s *RedisService) secretBackend() secretStore {
	if s.secrets != nil {
		return s.secrets
	}
	return mygoSecretStore{}
}

func normalizeCredentialStorage(mode string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case CredentialStorageLocal:
		return CredentialStorageLocal, nil
	case CredentialStorageKeychain:
		return CredentialStorageKeychain, nil
	default:
		return "", fmt.Errorf("unsupported credential storage mode %q", mode)
	}
}

func normalizeCredentialStorageOrDefault(mode string) string {
	if normalized, err := normalizeCredentialStorage(mode); err == nil {
		return normalized
	}
	return CredentialStorageLocal
}

func writeAtomicFile(path string, data []byte, perm os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmp)
		}
	}()
	if err := f.Chmod(perm); err != nil {
		_ = f.Close()
		return err
	}
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	cleanup = false
	return nil
}

func (s *RedisService) preferencesPath() (string, error) {
	dir, err := s.configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "preferences.json"), nil
}

func (s *RedisService) localKeyPath() (string, error) {
	dir, err := s.configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "credential.key"), nil
}

func (s *RedisService) loadPreferencesLocked() error {
	path, err := s.preferencesPath()
	if err != nil {
		return err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		s.credentialStorage = CredentialStorageLocal
		return nil
	}
	if err != nil {
		return err
	}
	var prefs appPreferences
	if err := json.Unmarshal(data, &prefs); err != nil {
		return fmt.Errorf("decode preferences: %w", err)
	}
	s.credentialStorage = normalizeCredentialStorageOrDefault(prefs.CredentialStorage)
	return nil
}

func (s *RedisService) savePreferencesLocked() error {
	path, err := s.preferencesPath()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(appPreferences{CredentialStorage: s.credentialStorage}, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomicFile(path, data, 0o600)
}

func (s *RedisService) ensureLocalKeyLocked() ([]byte, error) {
	if len(s.localKey) == localKeyByteLen {
		return s.localKey, nil
	}
	path, err := s.localKeyPath()
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(path)
	if err == nil {
		decoded, decErr := base64.RawStdEncoding.DecodeString(strings.TrimSpace(string(raw)))
		if decErr != nil {
			decoded, decErr = base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
		}
		if decErr != nil || len(decoded) != localKeyByteLen {
			return nil, errors.New("invalid local credential key")
		}
		s.localKey = decoded
		return s.localKey, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	key := make([]byte, localKeyByteLen)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, err
	}
	encoded := base64.RawStdEncoding.EncodeToString(key) + "\n"
	if err := writeAtomicFile(path, []byte(encoded), 0o600); err != nil {
		return nil, err
	}
	s.localKey = key
	return s.localKey, nil
}

func (s *RedisService) encryptPasswordLocked(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	key, err := s.ensureLocalKeyLocked()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(plain), nil)
	return encryptedPasswordPrefix + base64.RawStdEncoding.EncodeToString(sealed), nil
}

func (s *RedisService) decryptPasswordLocked(encoded string) (string, error) {
	if encoded == "" {
		return "", nil
	}
	if !strings.HasPrefix(encoded, encryptedPasswordPrefix) {
		return "", errors.New("unsupported encrypted password format")
	}
	raw, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(encoded, encryptedPasswordPrefix))
	if err != nil {
		return "", err
	}
	key, err := s.ensureLocalKeyLocked()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("encrypted password is truncated")
	}
	nonce, ciphertext := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func (s *RedisService) credentialStatusLocked() CredentialStorageStatus {
	pending := 0
	if s.credentialStorage == CredentialStorageLocal {
		for _, record := range s.records {
			if record.CredentialStore == credentialStoreKeychain {
				pending++
			}
		}
	}
	return CredentialStorageStatus{
		Mode:            s.credentialStorage,
		KeychainPending: pending,
	}
}

// GetCredentialStorage returns the active password storage mode.
func (s *RedisService) GetCredentialStorage() (CredentialStorageStatus, error) {
	if err := s.ensureLoaded(); err != nil {
		return CredentialStorageStatus{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.credentialStatusLocked(), nil
}

// SetCredentialStorage switches between local AES-256-GCM storage and the OS
// credential store, migrating saved connection passwords accordingly.
func (s *RedisService) SetCredentialStorage(mode string) (CredentialStorageStatus, error) {
	normalized, err := normalizeCredentialStorage(mode)
	if err != nil {
		return CredentialStorageStatus{}, err
	}
	if err := s.ensureLoaded(); err != nil {
		return CredentialStorageStatus{}, err
	}
	if normalized == CredentialStorageLocal {
		return s.switchToLocalStorage()
	}
	return s.switchToKeychainStorage()
}

func (s *RedisService) switchToLocalStorage() (CredentialStorageStatus, error) {
	s.mu.Lock()
	s.credentialStorage = CredentialStorageLocal
	if err := s.savePreferencesLocked(); err != nil {
		s.mu.Unlock()
		return CredentialStorageStatus{}, err
	}

	var toDeleteFromKeychain []string
	var needKeychainRead []string
	dirty := false

	for id, rec := range s.records {
		if rec.Password != "" {
			enc, err := s.encryptPasswordLocked(rec.Password)
			if err != nil {
				s.mu.Unlock()
				return CredentialStorageStatus{}, err
			}
			s.passwords[id] = rec.Password
			rec.EncryptedPassword = enc
			rec.Password = ""
			rec.CredentialStore = credentialStoreLocal
			s.records[id] = rec
			dirty = true
			continue
		}
		if rec.EncryptedPassword != "" {
			if rec.CredentialStore != credentialStoreLocal {
				rec.CredentialStore = credentialStoreLocal
				s.records[id] = rec
				dirty = true
			}
			continue
		}
		if rec.CredentialStore == credentialStoreNone {
			continue
		}
		if pw, cached := s.passwords[id]; cached {
			if pw == "" {
				rec.CredentialStore = credentialStoreNone
			} else {
				enc, err := s.encryptPasswordLocked(pw)
				if err != nil {
					s.mu.Unlock()
					return CredentialStorageStatus{}, err
				}
				rec.EncryptedPassword = enc
				rec.CredentialStore = credentialStoreLocal
			}
			rec.Password = ""
			s.records[id] = rec
			dirty = true
			toDeleteFromKeychain = append(toDeleteFromKeychain, id)
			continue
		}
		needKeychainRead = append(needKeychainRead, id)
	}

	if dirty {
		if err := s.saveLocked(); err != nil {
			s.mu.Unlock()
			return CredentialStorageStatus{}, err
		}
	}
	s.mu.Unlock()

	secrets := s.secretBackend()
	for _, id := range toDeleteFromKeychain {
		_ = secrets.Delete(passwordSecretKey(id))
	}

	for _, id := range needKeychainRead {
		secret, getErr := secrets.Get(passwordSecretKey(id))
		deleteAfterSave := false

		s.mu.Lock()
		rec, ok := s.records[id]
		if !ok {
			s.mu.Unlock()
			continue
		}
		switch {
		case getErr == nil:
			pw := string(secret)
			s.passwords[id] = pw
			if pw == "" {
				rec.CredentialStore = credentialStoreNone
				rec.Password = ""
				rec.EncryptedPassword = ""
			} else if enc, encErr := s.encryptPasswordLocked(pw); encErr == nil {
				rec.EncryptedPassword = enc
				rec.Password = ""
				rec.CredentialStore = credentialStoreLocal
			}
			s.records[id] = rec
			if s.saveLocked() == nil {
				deleteAfterSave = true
			}
		case errors.Is(getErr, mygo.ErrSecretNotFound):
			s.passwords[id] = ""
			rec.CredentialStore = credentialStoreNone
			s.records[id] = rec
			_ = s.saveLocked()
		case errors.Is(getErr, errors.ErrUnsupported):
			s.passwords[id] = ""
		default:
			if rec.CredentialStore == "" {
				rec.CredentialStore = credentialStoreKeychain
				s.records[id] = rec
				_ = s.saveLocked()
			}
		}
		s.mu.Unlock()

		if deleteAfterSave {
			_ = secrets.Delete(passwordSecretKey(id))
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	return s.credentialStatusLocked(), nil
}

func (s *RedisService) switchToKeychainStorage() (CredentialStorageStatus, error) {
	s.mu.Lock()
	toStore := make(map[string]string)
	for id, rec := range s.records {
		switch {
		case rec.Password != "":
			toStore[id] = rec.Password
		case rec.EncryptedPassword != "":
			pw, err := s.decryptPasswordLocked(rec.EncryptedPassword)
			if err != nil {
				s.mu.Unlock()
				return CredentialStorageStatus{}, fmt.Errorf("解密连接 %q 的本地密码失败: %w", rec.Name, err)
			}
			if pw != "" {
				toStore[id] = pw
			}
		case s.passwords[id] != "" && rec.CredentialStore != credentialStoreKeychain:
			toStore[id] = s.passwords[id]
		}
	}
	s.mu.Unlock()

	secrets := s.secretBackend()
	for id, pw := range toStore {
		if err := secrets.Set(passwordSecretKey(id), []byte(pw)); err != nil {
			return CredentialStorageStatus{}, fmt.Errorf("写入系统钥匙串失败: %w", err)
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.credentialStorage = CredentialStorageKeychain
	if err := s.savePreferencesLocked(); err != nil {
		return CredentialStorageStatus{}, err
	}
	dirty := false
	for id, rec := range s.records {
		if pw, ok := toStore[id]; ok {
			s.passwords[id] = pw
			rec.Password = ""
			rec.EncryptedPassword = ""
			rec.CredentialStore = credentialStoreKeychain
			s.records[id] = rec
			dirty = true
		} else if rec.EncryptedPassword == "" && rec.Password == "" && rec.CredentialStore == credentialStoreLocal {
			rec.CredentialStore = credentialStoreNone
			s.records[id] = rec
			dirty = true
		}
	}
	if dirty {
		if err := s.saveLocked(); err != nil {
			return CredentialStorageStatus{}, err
		}
	}
	return s.credentialStatusLocked(), nil
}

func (s *RedisService) resolvePassword(id string) (string, error) {
	s.mu.Lock()
	record, ok := s.records[id]
	if !ok {
		s.mu.Unlock()
		return "", fmt.Errorf("connection %q not found", id)
	}
	if pw, cached := s.passwords[id]; cached {
		s.mu.Unlock()
		return pw, nil
	}
	if record.Password != "" {
		pw := record.Password
		s.passwords[id] = pw
		s.mu.Unlock()
		return pw, nil
	}
	if record.EncryptedPassword != "" {
		pw, err := s.decryptPasswordLocked(record.EncryptedPassword)
		if err != nil {
			s.mu.Unlock()
			return "", fmt.Errorf("解密本地连接密码失败: %w", err)
		}
		s.passwords[id] = pw
		s.mu.Unlock()
		return pw, nil
	}
	if record.CredentialStore == credentialStoreNone || record.CredentialStore == credentialStoreLocal {
		s.passwords[id] = ""
		s.mu.Unlock()
		return "", nil
	}
	s.mu.Unlock()

	secrets := s.secretBackend()
	secret, getErr := secrets.Get(passwordSecretKey(id))

	var deleteFromKeychain bool
	s.mu.Lock()
	current, ok := s.records[id]
	if !ok {
		s.mu.Unlock()
		return "", fmt.Errorf("connection %q not found", id)
	}
	if pw, cached := s.passwords[id]; cached {
		s.mu.Unlock()
		return pw, nil
	}

	switch {
	case getErr == nil:
		pw := string(secret)
		s.passwords[id] = pw
		if s.credentialStorage == CredentialStorageLocal {
			if pw == "" {
				current.CredentialStore = credentialStoreNone
				current.Password = ""
				current.EncryptedPassword = ""
				s.records[id] = current
				if s.saveLocked() == nil {
					deleteFromKeychain = true
				}
			} else if enc, encErr := s.encryptPasswordLocked(pw); encErr == nil {
				current.EncryptedPassword = enc
				current.Password = ""
				current.CredentialStore = credentialStoreLocal
				s.records[id] = current
				if s.saveLocked() == nil {
					deleteFromKeychain = true
				}
			}
		} else if current.CredentialStore == "" {
			current.CredentialStore = credentialStoreKeychain
			s.records[id] = current
			_ = s.saveLocked()
		}
		s.mu.Unlock()
		if deleteFromKeychain {
			_ = secrets.Delete(passwordSecretKey(id))
		}
		return pw, nil

	case errors.Is(getErr, mygo.ErrSecretNotFound):
		s.passwords[id] = ""
		if current.CredentialStore == "" || (s.credentialStorage == CredentialStorageLocal && current.CredentialStore == credentialStoreKeychain) {
			current.CredentialStore = credentialStoreNone
			s.records[id] = current
			_ = s.saveLocked()
		}
		s.mu.Unlock()
		return "", nil

	case errors.Is(getErr, errors.ErrUnsupported):
		s.passwords[id] = ""
		s.mu.Unlock()
		return "", nil

	default:
		if current.CredentialStore == "" {
			current.CredentialStore = credentialStoreKeychain
			s.records[id] = current
			_ = s.saveLocked()
		}
		s.mu.Unlock()
		return "", fmt.Errorf("无法读取系统钥匙串中的密码（可在编辑连接中重新输入密码以保存到本地）: %w", getErr)
	}
}
