/** @type {import('next').NextConfig} */
const nextConfig = {
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