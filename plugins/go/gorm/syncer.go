package syncer_gorm

import (
	"gorm.io/gorm"
	// Import the CGO binding
	// "github.com/opto-sync/go-syncer"
)

// SyncerPlugin is a GORM plugin that hooks into Update/Create
type SyncerPlugin struct {
	TimestampKey string
}

func (p *SyncerPlugin) Name() string {
	return "opto_sync_syncer"
}

func (p *SyncerPlugin) Initialize(db *gorm.DB) error {
	// Register callbacks for Update
	db.Callback().Update().Before("gorm:update").Register("opto_sync:before_update", p.beforeUpdate)
	return nil
}

func (p *SyncerPlugin) beforeUpdate(db *gorm.Statement) {
	// Logic to extract JSONB fields, fetch current from DB, and merge using go-syncer
	// This would invoke the CGO merge function
}
