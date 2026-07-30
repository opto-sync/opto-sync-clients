import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const SUPPORTED_NATIVE_TARGETS = new Set([
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
  'win32-arm64',
]);

export function nativePlatformSupport(platform = process.platform, arch = process.arch) {
  const target = `${platform}-${arch}`;
  const supported = SUPPORTED_NATIVE_TARGETS.has(target);
  return {
    platform,
    arch,
    target,
    supported,
    message: supported
      ? `native target ${target} is supported`
      : `unsupported native target ${target}; the Node entry point requires a supported native addon. Use the browser export/WASM engine on this platform, or build on one of: ${[...SUPPORTED_NATIVE_TARGETS].sort().join(', ')}`,
  };
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  const result = nativePlatformSupport(
    process.argv[2] || process.platform,
    process.argv[3] || process.arch,
  );
  console.log(JSON.stringify(result));
  if (!result.supported) process.exitCode = 2;
}
