// Optional, previously installed compiler environments. These are deliberately
// not manifest runtime requirements: a plugin never makes the host ship Wine,
// Windows Python or a compiler image. New installations use their own paths.
export const MT5_RUNTIME_ENTRIES = Object.freeze({
  win32: ['windows_launcher', 'qemu', 'compiler_kernel', 'compiler_initrd', 'compiler_root_image'],
  darwin: ['qemu', 'qemu_bios', 'compiler_kernel', 'compiler_initramfs', 'compiler_root_image'],
  // A generic Linux research root is not evidence that Wine is installed.
  linux: ['linux_bwrap', 'linux_rootfs', 'linux_unsquashfs', 'linux_host_loader', 'compiler_toolchain'],
});

export function compilerRuntimeAvailable(runtime, platform = process.platform) {
  return runtime?.platform === platform && MT5_RUNTIME_ENTRIES[platform]?.every(role => typeof runtime.paths?.[role] === 'string' && runtime.paths[role].length > 0);
}
