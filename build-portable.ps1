$ErrorActionPreference = "Stop"

# Cleanup previous build artifacts
Remove-Item "src-tauri/binaries/server-x86_64-pc-windows-msvc.exe" -Force -ErrorAction Ignore
if (Test-Path "src-tauri/target/release/server-x86_64-pc-windows-msvc.exe") {
    Remove-Item "src-tauri/target/release/server-x86_64-pc-windows-msvc.exe" -Force
}
if (Test-Path "src-tauri/target/release/agent-uac-desktop.exe") {
    Remove-Item "src-tauri/target/release/agent-uac-desktop.exe" -Force
}

# Build Backend (TS -> JS)
echo "Building backend..."
npm run build:core

# Bundle Backend (ESM -> CJS) for pkg compatibility
echo "Bundling backend with esbuild..."
npx esbuild src/api/server.ts --bundle --platform=node --target=node18 --outfile=dist/server-bundle.cjs

# Compile Backend to Standalone Exe (CJS Bundle -> EXE)
echo "Compiling backend to standalone exe..."
npx -y pkg dist/server-bundle.cjs --targets node18-win-x64 --output src-tauri/binaries/server-x86_64-pc-windows-msvc.exe --public

# Mitigations for PermissionDenied
echo "Unblocking binary and waiting for file handles..."
Unblock-File "src-tauri/binaries/server-x86_64-pc-windows-msvc.exe" -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Clean build script artifacts to prevent stale locks
if (Test-Path "src-tauri/target/release/build/agent-uac-desktop-*") {
    echo "Cleaning build script artifacts..."
    Remove-Item "src-tauri/target/release/build/agent-uac-desktop-*" -Recurse -Force -ErrorAction SilentlyContinue
}

# Build Frontend (Vite)
echo "Building frontend..."
npm run build:web

# Build Tauri App
echo "Building Tauri app..."
npm run tauri:build

# Fix sidecar for portable executable (Tauri renames it or leaves it out of root)
echo "Copying sidecar for portable use..."
Copy-Item "src-tauri/binaries/server-x86_64-pc-windows-msvc.exe" -Destination "src-tauri/target/release/"

echo "Build complete! Check src-tauri/target/release/bundle/"
