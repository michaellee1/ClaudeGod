# Bug Fix: Think Mode "None" Tasks Marked as Finished Prematurely

## Issue Description

Tasks with think mode "None" were being incorrectly marked as finished when only the editor process completed, without running the reviewer phase. This happened specifically during server restarts or when reconnecting to existing processes.

## Root Cause

The bug was in the `monitorExistingProcesses` method in `process-manager.ts`. The code incorrectly assumed that if:
- The current phase is "editor"
- An editor PID exists
- No reviewer PID exists

Then the task must be in `no_review` mode and should be marked as finished.

This logic failed to account for:
1. The time gap between editor completion and reviewer startup
2. Tasks with think mode "None" that should run both phases
3. The lack of think mode information during process reconnection

## Solution

### Changes Made

1. **Updated `reconnectToProcesses` method** to accept and store the `thinkMode` parameter:
   ```typescript
   async reconnectToProcesses(pids: {...}, phase: string, thinkMode?: string) {
     this.currentPhase = phase as any
     this.thinkMode = thinkMode
     // ...
   }
   ```

2. **Modified `monitorExistingProcesses` logic** to check think mode before marking as finished:
   ```typescript
   if (this.currentPhase === 'editor' && pids.editorPid && !pids.reviewerPid) {
     // Only mark as finished if we're in no_review mode
     if (this.thinkMode === 'no_review') {
       // Mark as finished
     } else {
       // Mark as failed - editor exited without starting reviewer
     }
   }
   ```

3. **Updated task-store.ts** to pass think mode during reconnection:
   ```typescript
   await processManager.reconnectToProcesses({...}, phase, task.thinkMode)
   ```

4. **Added logging** to help debug think mode handling in the future

## Think Mode Values

- `"none"` - Normal mode, runs both editor and reviewer phases
- `"no_review"` - Skips the reviewer phase
- `"level1"` - Think hard mode
- `"level2"` - Ultrathink mode
- `"planning"` - Planning mode with separate planner phase

## Testing

To verify the fix:
1. Create a task with think mode "None"
2. Wait for the editor phase to complete
3. Restart the server before the reviewer starts
4. Confirm the task is not marked as finished and continues properly

## Impact

This fix ensures that:
- Tasks with think mode "None" always run both editor and reviewer phases
- Process reconnection correctly handles all think modes
- Users don't lose the reviewer phase due to server restarts