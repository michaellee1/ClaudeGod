/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable hot reloading when working on self-modification tasks
  watchOptions: {
    ignored: [
      '**/node_modules/**',
      '**/.git/**',
      '**/claude-god-worktrees/**',
      '**/.claude-god-data/**',
      '**/.next/**',
      '**/.env*',
      '**/*.log',
      // Ignore main repo files to prevent restarts during merges
      '**/app/**',
      '**/lib/**',
      '**/components/**',
      '**/public/**',
      '**/styles/**'
    ],
    // Increase polling interval to reduce file system watching overhead
    poll: 5000
  },
  // Disable webpack watching in production
  webpack: (config, { dev }) => {
    if (!dev) {
      config.watchOptions = {
        ignored: /.*/
      }
    }
    return config
  }
}

module.exports = nextConfig