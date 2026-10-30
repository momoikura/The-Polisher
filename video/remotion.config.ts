import path from "node:path";
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(92);
Config.setOverwriteOutput(true);
Config.setDefaultPremountInSeconds(2);
// The video renders the app's real components from packages/web.
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    extensionAlias: { ".js": [".tsx", ".ts", ".js"] },
    alias: {
      ...(config.resolve?.alias as object),
      react: path.resolve("node_modules/react"),
      "react-dom": path.resolve("node_modules/react-dom"),
    },
  },
}));
