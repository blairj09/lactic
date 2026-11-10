// swift-tools-version:5.9

import PackageDescription

let package = Package(
  name: "tauri-plugin-lactic-phone",
  platforms: [
    .macOS(.v10_15),
    .iOS(.v16),
  ],
  products: [
    .library(name: "tauri-plugin-lactic-phone", type: .static, targets: ["tauri-plugin-lactic-phone"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-lactic-phone",
      dependencies: [.byName(name: "Tauri")],
      path: "Sources")
  ]
)
