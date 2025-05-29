# Merge Conflict Resolution UI Enhancement

## Overview
When a merge conflict is detected during task merging, the system now provides a real-time rolling output window that shows Claude Code's progress as it attempts to automatically resolve the conflicts.

## Features

### 1. Real-time Output Streaming
- WebSocket-based streaming of Claude Code output
- Shows all stages of conflict resolution:
  - System messages (analyzing conflicts, staging files, etc.)
  - Claude Code output (file operations, resolution steps)
  - Error messages if resolution fails

### 2. Rolling Output Window
- Terminal-style output display with dark theme
- Auto-scrolls to show latest output
- Preserves full history of the resolution process
- Monospace font for better readability

### 3. Progress Indicator
- Animated spinner shows active processing
- "Hide Progress" button allows users to dismiss the dialog while resolution continues
- Dialog automatically closes 2 seconds after completion (success or failure)

### 4. Integration with Existing UI
- Seamlessly integrates with the existing merge conflict dialog
- If automatic resolution fails, falls back to manual resolution options
- All output is also preserved in the task's output history

## Implementation Details

### Backend Components
1. **MergeConflictResolver** (`lib/utils/merge-conflict-resolver.ts`)
   - Added output callback mechanism
   - Streams output via `sendOutput()` method
   - Uses `spawn` instead of `execFile` for real-time streaming

2. **Git Utils** (`lib/utils/git.ts`)
   - Accepts output callback parameter in `mergeWorktreeToMain()`
   - Passes callback to conflict resolver

3. **Task Store** (`lib/utils/task-store.ts`)
   - Broadcasts conflict resolution output via WebSocket
   - Adds outputs with type `merge-conflict-resolver`

### Frontend Components
1. **Task Detail Page** (`app/task/[id]/page.tsx`)
   - New state: `isResolvingConflict` and `conflictResolutionOutputs`
   - WebSocket handler detects merge conflict resolver outputs
   - New dialog component shows rolling output window
   - Auto-scroll behavior for smooth UX

### Output Types
- `system`: General progress messages
- `claude-code`: Output from Claude Code CLI
- `error`: Error messages during resolution

## User Experience
1. User clicks "Merge" button
2. If conflicts detected, resolution starts automatically
3. Progress dialog appears with real-time output
4. User can watch Claude Code work through the conflicts
5. On success: Dialog closes, task is merged
6. On failure: Falls back to manual resolution options

This enhancement provides transparency into the automatic conflict resolution process, helping users understand what's happening rather than showing a semi-hanging UI.