/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Lower the dev server's memory use (it grew past 3 GB on an 8 GB machine and stalled).
    webpackMemoryOptimizations: true,
  },
  // Run data and prompt files change while the app runs; don't let the dev watcher react to them.
  webpack: (config) => {
    config.watchOptions = { ...config.watchOptions, ignored: ["**/node_modules/**", "**/data/**", "**/agents/**", "**/.git/**"] };
    return config;
  },
};
export default nextConfig;
