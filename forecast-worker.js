/* Browser-only compute worker. The shared estimator remains unchanged. */
importScripts("./member-statistics.js", "./group-probability.js");
self.onmessage = ({ data }) => {
  const { id, key, input } = data || {};
  try {
    const started = performance.now();
    const forecast = self.BadmintonGroupProbability.estimate({ ...input, includeCandidates: true, includeCounterfactuals: false });
    self.postMessage({ id, key, forecast, durationMs: performance.now() - started });
  } catch (error) {
    self.postMessage({ id, key, error: String(error?.message || error) });
  }
};
