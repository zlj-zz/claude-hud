import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { HudConfig } from './config.js';
import type { ExternalUsageSnapshot, UsageData } from './types.js';

function parseUsagePercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(Math.min(100, Math.max(0, value)));
}

function parseDateValue(value: unknown): Date | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }
    const millis = value > 1e12 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function parseUpdatedAt(value: unknown): number | null {
  const date = parseDateValue(value);
  return date ? date.getTime() : null;
}

function parseSnapshot(raw: string): ExternalUsageSnapshot | null {
  try {
    return JSON.parse(raw) as ExternalUsageSnapshot;
  } catch {
    return null;
  }
}

function snapshotToUsageData(parsed: ExternalUsageSnapshot): UsageData | null {
  const updatedAt = parseUpdatedAt(parsed.updated_at);
  if (updatedAt === null) {
    return null;
  }

  const fiveHour = parseUsagePercent(parsed.five_hour?.used_percentage);
  const sevenDay = parseUsagePercent(parsed.seven_day?.used_percentage);
  if (fiveHour === null && sevenDay === null) {
    return null;
  }

  const fiveHourResetAt = parseDateValue(parsed.five_hour?.resets_at);
  const sevenDayResetAt = parseDateValue(parsed.seven_day?.resets_at);

  if (parsed.five_hour && parsed.five_hour.resets_at != null && fiveHourResetAt === null) {
    return null;
  }
  if (parsed.seven_day && parsed.seven_day.resets_at != null && sevenDayResetAt === null) {
    return null;
  }

  return {
    fiveHour,
    sevenDay,
    fiveHourResetAt,
    sevenDayResetAt,
  };
}

/**
 * Execute the external usage command synchronously to regenerate the snapshot file.
 * Returns true if the command exited successfully.
 */
function runExternalUsageCommand(command: string): boolean {
  try {
    const result = spawnSync(command, {
      shell: true,
      stdio: 'pipe',
      timeout: 10_000,
      env: process.env,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function readSnapshotFile(snapshotPath: string): ExternalUsageSnapshot | null {
  try {
    const raw = fs.readFileSync(snapshotPath, 'utf8');
    return parseSnapshot(raw);
  } catch {
    return null;
  }
}

export function getUsageFromExternalSnapshot(
  config: HudConfig,
  now = Date.now(),
): UsageData | null {
  const snapshotPath = config.display.externalUsagePath;
  if (!snapshotPath) {
    return null;
  }

  const freshnessMs = config.display.externalUsageFreshnessMs;
  const command = config.display.externalUsageCommand;

  // Try reading the file first
  const snapshot = readSnapshotFile(snapshotPath);
  let isStale = false;
  if (snapshot !== null) {
    const updatedAt = parseUpdatedAt(snapshot.updated_at);
    isStale = updatedAt !== null && now - updatedAt > freshnessMs;
  }

  let parsed = snapshot;

  // If missing or stale and a command is configured, regenerate
  if ((parsed === null || isStale) && command) {
    runExternalUsageCommand(command);
    // Re-read after command execution
    parsed = readSnapshotFile(snapshotPath);
  }

  if (parsed === null) {
    return null;
  }

  const updatedAt = parseUpdatedAt(parsed.updated_at);
  if (updatedAt === null || now - updatedAt > freshnessMs) {
    return null;
  }

  return snapshotToUsageData(parsed);
}
