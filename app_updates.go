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
}

// AppService exposes application actions to the main window. The updater
// plugin keeps its download, signature verification and restart UI separate.
type AppService struct{}

func (s *AppService) GetAppInfo() AppInfo {
	return AppInfo{
		Version:        mygo.App.Version(),
		IsDev:          mygo.IsDev(),
		UpdatesEnabled: mygo.Updater.Enabled(),
	}
}

// CheckForUpdates opens the built-in update window without installing or
// restarting automatically. The plugin handles repeated calls and UI dispatch.
func (s *AppService) CheckForUpdates() {
	updater.CheckForUpdates()
}
