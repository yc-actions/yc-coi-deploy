const path = require("path");

/*
 * For a detailed explanation regarding each configuration property and type check, visit:
 * https://jestjs.io/docs/configuration
 */

module.exports = {
  moduleFileExtensions: [
    "js",
    "ts",
    "json"
  ],
  preset: "ts-jest",
  rootDir: path.resolve("./__tests__/"),
  transform: {
    "^.+\\.ts$": ["@swc/jest", {
      jsc: {
        parser: {
          syntax: "typescript",
          tsx: true
        }
      }
    }]
  },
  testEnvironment: "node"

};
