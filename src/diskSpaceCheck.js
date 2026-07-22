import { statfsSync } from "node:fs";

// Keep low-disk handling deterministic and local.  This check does not delete
// caches or files; it only tells the operator whether a deployment/recovery
// operation has enough headroom for atomic temporary files and backups.
export function parseMinimumFreeBytes(value = "") {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 512 * 1024 * 1024;
  return Math.floor(parsed);
}

export function buildDiskSpaceCheck({ path = process.cwd(), minimumFreeBytes, statfs = statfsSync } = {}) {
  const minimum = parseMinimumFreeBytes(minimumFreeBytes);
  try {
    const stats = statfs(path);
    const blockSize = Number(stats.bavail != null ? stats.bsize : 0);
    const availableBlocks = Number(stats.bavail);
    const availableBytes = Number.isFinite(blockSize) && Number.isFinite(availableBlocks)
      ? Math.max(0, Math.floor(blockSize * availableBlocks))
      : NaN;
    if (!Number.isFinite(availableBytes)) {
      return {
        ok: false,
        code: "DISK_SPACE_UNAVAILABLE",
        path,
        minimumFreeBytes: minimum,
        availableBytes: null,
        nextAction: "无法读取部署目录的剩余空间；先确认文件系统健康后再做迁移或恢复。",
      };
    }
    const ok = availableBytes >= minimum;
    return {
      ok,
      code: ok ? "DISK_SPACE_OK" : "LOW_DISK_SPACE",
      path,
      minimumFreeBytes: minimum,
      availableBytes,
      nextAction: ok
        ? "磁盘剩余空间满足本地原子临时文件和备份的最低余量。"
        : `部署目录剩余空间不足（${availableBytes} bytes）；先释放或扩容磁盘，再执行迁移/恢复。不会自动删除文件。`,
    };
  } catch (error) {
    return {
      ok: false,
      code: "DISK_SPACE_UNAVAILABLE",
      path,
      minimumFreeBytes: minimum,
      availableBytes: null,
      nextAction: "无法读取部署目录的剩余空间；先确认文件系统健康后再做迁移或恢复。",
      error: String(error?.code || error?.message || "statfs_failed").slice(0, 160),
    };
  }
}
