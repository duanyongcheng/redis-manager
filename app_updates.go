package main

import (
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/updater"
)

// AppInfo describes the running build, independently of any Redis connection.
type AppInfo struct {
	Version        string `json:"version"`
	IsDev          bool   `json:"isDev"`
	UpdatesEnabled bool   `json:"updatesEnabled"`
	ConfigDir      string `json:"configDir,omitempty"`
}

// AppService exposes application actions to the main window. The updater
// plugin keeps its download, signature verification and restart UI separate.
type AppService struct{}

func (s *AppService) GetAppInfo() AppInfo {
	dir, _ := defaultConfigDir()
	return AppInfo{
		Version:        mygo.App.Version(),
		IsDev:          mygo.IsDev(),
		UpdatesEnabled: mygo.Updater.Enabled(),
		ConfigDir:      dir,
	}
}

// CheckForUpdates opens the built-in update window without installing or
// restarting automatically. The plugin handles repeated calls and UI dispatch.
func (s *AppService) CheckForUpdates() {
	updater.CheckForUpdates()
}
