/** @type {import('next').NextConfig} */
const nextConfig = {
  // The editor engine attaches to the DOM once; StrictMode's double mount is
  // already guarded, but keeping it off avoids a second set of listeners in dev.
  reactStrictMode: false,
  // There's an unrelated package-lock.json in the home folder; pin the root here.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
