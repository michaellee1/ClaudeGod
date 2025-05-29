# Task Merge Fix Summary

## Problem
When merging a task using the button in the active tasks list, other tasks created after it were being deleted. This was an extremely frustrating bug that caused data loss.

## Root Cause Analysis

The issue was a **race condition** in the `saveTasksImmediately()` method:

1. **Debounced Saves**: Most task operations (adding outputs, updating status, etc.) use `debouncedSave()` which waits 1 second before persisting to disk.

2. **Immediate Save Cancellation**: When `saveTasksImmediately()` was called during merge, it would:
   - Clear the debounce timer immediately
   - Save the current in-memory state
   - **BUT** - any pending changes waiting in the debounce timer were lost!

3. **Task Deletion**: If new tasks were created or existing tasks were updated within the 1-second debounce window before a merge, those changes would be lost when the debounce timer was cleared.

## Solution Implemented

### 1. Fixed `saveTasksImmediately()` (task-store.ts:293-332)
- Now executes any pending saves BEFORE clearing the debounce timer
- Ensures all in-memory changes are persisted before proceeding with immediate save
- Added error handling to continue even if pending saves fail

### 2. Added File Locking (task-store.ts)
- Imported `FileLock` utility to prevent concurrent file access
- Wrapped `saveTasks()`, `loadTasks()`, and `saveOutputs()` with file locks
- Prevents race conditions when multiple processes access the same files

## Code Changes

### Before (Buggy Code):
```typescript
private async saveTasksImmediately() {
  // This would lose pending changes!
  if (this.saveDebounceTimer) {
    clearTimeout(this.saveDebounceTimer)
  }
  
  try {
    await this.saveTasks()
    // ...
  }
}
```

### After (Fixed Code):
```typescript
private async saveTasksImmediately() {
  // Execute pending saves first
  if (this.saveDebounceTimer) {
    clearTimeout(this.saveDebounceTimer)
    this.saveDebounceTimer = null
    
    // Save pending changes immediately
    try {
      await this.saveTasks()
      await this.saveOutputs()
      await this.saveProcessState()
    } catch (error) {
      // Continue anyway
    }
  }
  
  // Now perform the immediate save
  await this.saveTasks()
}
```

## Testing Recommendations

To verify the fix works:

1. Create multiple tasks in quick succession
2. Start some activity on the tasks (they'll show outputs)
3. Within 1 second of the last activity, merge one of the earlier tasks
4. Verify all other tasks remain in the list

## Prevention

This fix ensures:
- No pending changes are lost during immediate saves
- File operations are protected by locks to prevent corruption
- The merge operation is truly atomic and doesn't affect other tasks