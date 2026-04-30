import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RenderContext } from '../../types.js';
import { dim, label } from '../colors.js';

const CONTROL_AND_BIDI_PATTERN = new RegExp(
  '[' +
  '\\u0000-\\u001F\\u007F-\\u009F' +
  '\\u061C\\u200E\\u200F' +
  '\\u202A-\\u202E\\u2066-\\u2069\\u206A-\\u206F' +
  ']',
  'g',
);

export function sanitize(value: string): string {
  return value.replace(CONTROL_AND_BIDI_PATTERN, '');
}

function basenameOf(dir: string): string {
  const segments = dir.split(/[/\\]/).filter(Boolean);
  return segments[segments.length - 1] ?? dir;
}

export function normalizeAddedDirs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is string =>
      typeof v === 'string' &&
      v.length > 0 &&
      sanitize(basenameOf(v)).length > 0,
  );
}

function getFileHref(filePath: string): string | null {
  try {
    return pathToFileURL(path.resolve(filePath)).toString();
  } catch {
    return null;
  }
}

function hyperlink(uri: string, text: string): string {
  const esc = '\x1b';
  const st = '\\';
  return `${esc}]8;;${uri}${esc}${st}${text}${esc}]8;;${esc}${st}`;
}

function safeHyperlink(uri: string | null, text: string): string {
  if (!uri) return text;
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'file:') return text;
    return hyperlink(parsed.toString(), text);
  } catch {
    return text;
  }
}

export function renderAddedDirsLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  if (display?.showAddedDirs === false) return null;
  if ((display?.addedDirsLayout ?? 'inline') !== 'line') return null;

  const dirs = normalizeAddedDirs(ctx.stdin.workspace?.added_dirs);
  if (dirs.length === 0) return null;

  const colors = ctx.config?.colors;
  const rendered = dirs.map((dir) => {
    const name = sanitize(basenameOf(dir));
    return safeHyperlink(getFileHref(dir), dim(name));
  });

  return `${label('Added dirs:', colors)} ${rendered.join(dim(', '))}`;
}
