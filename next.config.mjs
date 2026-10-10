/** @type {import('next').NextConfig} */
const nextConfig = {
  // The editor engine attaches to the DOM once; StrictMode's double mount is
  // already guarded, but keeping it off avoids a second set of listeners in dev.
  reactStrictMode: false,
  // No Next.js badge in the corner of the editor during development.
  devIndicators: false,
  turbopack: {
    // There's an unrelated package-lock.json in the home folder; pin the root here.
    root: import.meta.dirname,
    rules: {
      // Design System Studio generates some .jsx files that contain TypeScript
      // syntax (`x as T`, `useRef<T>()`). Parse them as TSX so the types are
      // stripped, without editing the generated folder (a re-pull replaces it).
      '*.jsx': {
        condition: { path: /^design-system\// },
        loaders: ['./build/passthrough-loader.cjs'],
        as: '*.tsx',
      },
    },
  },
};

export default nextConfig;
