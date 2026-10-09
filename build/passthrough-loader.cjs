// Returns the source unchanged. Used in next.config.mjs only so that a Turbopack
// rule can re-type design-system .jsx files as .tsx (rules need a loader).
module.exports = function passthrough(source) {
  return source;
};
