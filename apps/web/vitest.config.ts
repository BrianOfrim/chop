import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/lib/foilAnalysis.test.ts",
      "src/lib/reviewPath.test.ts",
      "src/lib/forecastChart.axis.test.ts",
      "src/lib/mapCamera.test.ts",
      "src/lib/stationModelDelta.test.ts",
    ],
  },
});
