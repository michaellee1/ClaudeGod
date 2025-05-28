const fs = require('fs/promises')
const path = require('path')
const os = require('os')

// Check if a merge is in progress to prevent hot reload
async function isMergeInProgress() {
  try {
    const dataDir = path.join(os.homedir(), '.claude-god-data')
    const mergeMarkerPath = path.join(dataDir, '.merge-in-progress')
    await fs.access(mergeMarkerPath)
    return true
  } catch {
    return false
  }
}

// Middleware to prevent hot reload during merges
function mergeProtectionMiddleware() {
  if (process.env.NODE_ENV === 'development') {
    // Override the file watcher behavior
    const originalWatchFile = global.watchFile
    if (originalWatchFile) {
      global.watchFile = async (...args) => {
        if (await isMergeInProgress()) {
          console.log('Merge in progress - skipping file watch update')
          return
        }
        return originalWatchFile(...args)
      }
    }
  }
}

module.exports = {
  isMergeInProgress,
  mergeProtectionMiddleware
}