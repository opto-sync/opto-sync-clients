// swift-tools-version: 5.9
import PackageDescription
let package = Package(
  name: "OptoSyncClient",
  platforms: [.iOS(.v15), .macOS(.v12)],
  products: [.library(name: "OptoSyncClient", targets: ["OptoSyncClient"])],
  targets: [.target(name: "OptoSyncClient")]
)
