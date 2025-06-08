import { spawn } from 'child_process'

export function runAppleScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('osascript', ['-e', script])
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => stdout += data.toString())
    proc.stderr.on('data', (data) => stderr += data.toString())

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`AppleScript error (${code}):\n${stderr}`))
      } else {
        resolve(stdout.trim())
      }
    })
  })
}

export async function spawnTaggedSession(tag: string, command: string): Promise<void> {
  console.log(`[iTerm] Spawning session with command: ${command}`)
  
  // For AppleScript strings, we need to escape backslashes and double quotes
  // Single quotes in the shell command should be fine within AppleScript double quotes
  const escapedCommand = command
    .replace(/\\/g, '\\\\')  // Escape backslashes
    .replace(/"/g, '\\"')    // Escape double quotes
    
  const escapedTag = tag
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
  
  // Create a new window and immediately write the command
  // iTerm will execute it automatically when using 'write text'
  const script = `
    tell application "iTerm"
      create window with default profile
      tell current session of current window
        set name to "${escapedTag}"
        write text "${escapedCommand}"
      end tell
    end tell
  `
  
  console.log(`[iTerm] Executing AppleScript...`)
  
  try {
    await runAppleScript(script)
    console.log(`[iTerm] Successfully spawned session with tag: ${tag}`)
  } catch (error) {
    console.error(`[iTerm] Failed to spawn session:`, error)
    throw error
  }
}

export async function focusTaggedSession(tag: string): Promise<void> {
  const escapedTag = tag.replace(/"/g, '\\"')
  const script = `
    tell application "iTerm"
      repeat with aWindow in windows
        repeat with aTab in tabs of aWindow
          repeat with aSession in sessions of aTab
            if name of aSession is "${escapedTag}" then
              select aWindow
              select aTab
              select aSession
              activate
              return
            end if
          end repeat
        end repeat
      end repeat
    end tell
  `
  await runAppleScript(script)
  console.log(`[iTerm] Focused session with tag: ${tag}`)
}

export async function sendTextToSession(tag: string, text: string): Promise<void> {
  const escapedText = text.replace(/"/g, '\\"').replace(/\n/g, '\\n')
  const script = `
    tell application "iTerm"
      repeat with aWindow in windows
        repeat with aTab in tabs of aWindow
          repeat with aSession in sessions of aTab
            if name of aSession is "${tag}" then
              tell aSession
                write text "${escapedText}"
              end tell
              return
            end if
          end repeat
        end repeat
      end repeat
    end tell
  `
  await runAppleScript(script)
  console.log(`[iTerm] Sent text to session with tag: ${tag}`)
}

export async function closeSession(tag: string): Promise<void> {
  const script = `
    tell application "iTerm"
      repeat with aWindow in windows
        repeat with aTab in tabs of aWindow
          repeat with aSession in sessions of aTab
            if name of aSession is "${tag}" then
              close aSession
              return
            end if
          end repeat
        end repeat
      end repeat
    end tell
  `
  await runAppleScript(script)
  console.log(`[iTerm] Closed session with tag: ${tag}`)
}