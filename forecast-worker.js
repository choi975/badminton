/* global BadmintonGroupProbability */
importScripts("./member-statistics.js", "./group-probability.js");
self.onmessage = ({ data }) => {
  const { id, key, input } = data || {};
  try {
    const started = performance.now();
    const forecast = self.BadmintonGroupProbability.estimate({ ...input, includeCandidates: true, includeCounterfactuals: false });
    if (input.includeWeek) {
      const dates = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(input.targetDate + "T00:00:00Z") + i * 86400000).toISOString().slice(0, 10));
      forecast.week = [forecast.today];
      for (const date of dates.slice(1)) {
        const day = self.BadmintonGroupProbability.estimate({ ...input, targetDate: date,
          entries: input.plannedEntries?.[date] || [], confirmedEntries: true,
          includeCandidates: false, includeCounterfactuals: false, simulations: 800, calibrationSimulations: 400 });
        forecast.week.push(day.today);
      }
      forecast.tomorrow = forecast.week[1];
      forecast.tomorrowProbability = forecast.tomorrow.probability;
    }
    self.postMessage({ id, key, forecast, durationMs: performance.now() - started });
  } catch (error) {
    self.postMessage({ id, key, error: String(error?.message || error) });
  }
};
