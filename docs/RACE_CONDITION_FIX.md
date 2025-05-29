# Race Condition Bug Analysis and Fix

## Bug Description
Tasks created after a merged task are sometimes deleted due to a race condition between immediate saves and debounced saves.

## Root Cause Analysis

### The Race Condition Sequence:
1. **Task A is merged** → `saveTasksImmediately()` is called
2. **Inside mergeTask**, after the immediate save, `addOutput()` is called for self-modification tasks
3. **addOutput() calls `debouncedSave()`** which schedules a save in 1 second
4. **Task B is created** after the merge but before the debounced save fires
5. **The debounced save fires** and might use a stale snapshot of the tasks Map
6. **Result**: Task B is lost

### Why the Current Fix Didn't Work:
The fix in commit 9b7fbf5 addressed one race condition in `saveTasksImmediately()` by executing pending saves before clearing the timer. However, it didn't address the race condition that occurs AFTER the immediate save when new debounced saves are scheduled.

## The Fix

### Solution 1: Prevent Debounced Saves After Immediate Saves
Add a flag to prevent debounced saves from being scheduled immediately after an immediate save.

### Solution 2: Use a Save Queue
Instead of debounced saves potentially overwriting each other, use a queue-based approach where saves are serialized.

### Solution 3: Make addOutput Not Trigger Saves During Critical Operations
Add a flag to prevent addOutput from triggering saves during merge operations.

## Recommended Fix Implementation

The most robust solution is to implement a save queue that ensures all saves are serialized and no data is lost:

```typescript
private saveQueue: Promise<void> = Promise.resolve();
private enqueueSave(operation: () => Promise<void>): Promise<void> {
  this.saveQueue = this.saveQueue.then(operation).catch(console.error);
  return this.saveQueue;
}
```

This ensures that:
1. All save operations happen in order
2. No save can overwrite another save's data
3. The in-memory state is always correctly persisted