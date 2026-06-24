// swift-tools-version: 5.9

import PackageDescription

let package = Package(
  name: "otto-os-swift-sdk",
  platforms: [
    .iOS(.v16),
    .macOS(.v13)
  ],
  products: [
    .library(name: "OttoSDK", targets: ["OttoSDK"])
  ],
  targets: [
    .target(name: "OttoSDK", path: "Sources/OttoSDK"),
    .testTarget(name: "OttoSDKTests", dependencies: ["OttoSDK"], path: "Tests/OttoSDKTests")
  ]
)
