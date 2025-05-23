/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable hot reloading when working on self-modification tasks
  watchOptions: {
    ignored: [
      '**/node_modules/**',
      '**/.git/**',
      '**/claude-god-worktrees/**',
      '**/.claude-god-data/**',
      '**/.next/**'
    ]
  }
}

module.exports = nextConfig