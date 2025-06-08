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
  const escapedCommand = command.replace(/"/g, '\\"')
  const script = `
    tell application "iTerm"
      set newWindow to (create window with default profile)
      tell current session of newWindow
        set name to "${tag}"
        write text "${escapedCommand}; exec bash"
      end tell
    end tell
  `
  await runAppleScript(script)
  console.log(`[iTerm] Spawned session with tag: ${tag}`)
}

export async function focusTaggedSession(tag: string): Promise<void> {
  const script = `
    tell application "iTerm"
      repeat with aWindow in windows
        repeat with aTab in tabs of aWindow
          repeat with aSession in sessions of aTab
            if name of aSession is "${tag}" then
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