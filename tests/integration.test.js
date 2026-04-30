import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";

function stripAnsi(text) {
  return text
    .replace(
      /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><]/g,
      "",
    )
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
}

function skipIfSpawnBlocked(result, t) {
  if (result.error?.code === "EPERM") {
    t.skip("spawnSync is blocked by sandbox policy in this environment");
    return true;
  }
  return false;
}

test("CLI renders expected output for a basic transcript", async (t) => {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/transcript-render.jsonl", import.meta.url),
  );
  const expectedPath = fileURLToPath(
    new URL("./fixtures/expected/render-basic.txt", import.meta.url),
  );
  const expected = readFileSync(expectedPath, "utf8").trimEnd();

  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-home-"));
  // Use a fixed 3-level path for deterministic test output
  const projectDir = path.join(homeDir, "dev", "apps", "my-project");
  await import("node:fs/promises").then((fs) =>
    fs.mkdir(projectDir, { recursive: true }),
  );
  try {
    const stdin = JSON.stringify({
      model: { display_name: "Opus" },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 45000 },
      },
      transcript_path: fixturePath,
      cwd: projectDir,
    });

    const result = spawnSync("node", ["dist/index.js"], {
      cwd: path.resolve(process.cwd()),
      input: stdin,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, LANG: "C" },
    });

    if (skipIfSpawnBlocked(result, t)) return;

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || "non-zero exit");
    const normalized = stripAnsi(result.stdout)
      .replace(/\u00A0/g, " ")
      .trimEnd();
    if (process.env.UPDATE_SNAPSHOTS === "1") {
      await writeFile(expectedPath, normalized + "\n", "utf8");
      return;
    }
    assert.equal(normalized, expected);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("CLI renders added_dirs basenames on the project line", async (t) => {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/transcript-render.jsonl", import.meta.url),
  );
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-home-"));
  const projectDir = path.join(homeDir, "dev", "apps", "my-project");
  const addedDirA = path.join(homeDir, "dev", "apps", "lib-foo");
  const addedDirB = path.join(homeDir, "dev", "apps", "some-other-repo");
  await import("node:fs/promises").then((fs) =>
    Promise.all([
      fs.mkdir(projectDir, { recursive: true }),
      fs.mkdir(addedDirA, { recursive: true }),
      fs.mkdir(addedDirB, { recursive: true }),
    ]),
  );
  try {
    const stdin = JSON.stringify({
      model: { display_name: "Opus" },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 45000 },
      },
      transcript_path: fixturePath,
      cwd: projectDir,
      workspace: {
        current_dir: projectDir,
        added_dirs: [addedDirA, addedDirB],
      },
    });

    const result = spawnSync("node", ["dist/index.js"], {
      cwd: path.resolve(process.cwd()),
      input: stdin,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, LANG: "C" },
    });

    if (skipIfSpawnBlocked(result, t)) return;

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || "non-zero exit");
    const firstLine = stripAnsi(result.stdout).split("\n")[0];
    assert.match(firstLine, /\+lib-foo/);
    assert.match(firstLine, /\+some-other-repo/);
    assert.ok(
      firstLine.indexOf("my-project") < firstLine.indexOf("+lib-foo"),
      "added dirs should come after the project name",
    );
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("CLI omits added dirs section when array is empty", async (t) => {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/transcript-render.jsonl", import.meta.url),
  );
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-home-"));
  const projectDir = path.join(homeDir, "dev", "apps", "my-project");
  await import("node:fs/promises").then((fs) =>
    fs.mkdir(projectDir, { recursive: true }),
  );
  try {
    const stdin = JSON.stringify({
      model: { display_name: "Opus" },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 45000 },
      },
      transcript_path: fixturePath,
      cwd: projectDir,
      workspace: { current_dir: projectDir, added_dirs: [] },
    });

    const result = spawnSync("node", ["dist/index.js"], {
      cwd: path.resolve(process.cwd()),
      input: stdin,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, LANG: "C" },
    });

    if (skipIfSpawnBlocked(result, t)) return;

    assert.equal(result.status, 0, result.stderr || "non-zero exit");
    const firstLine = stripAnsi(result.stdout).split("\n")[0];
    assert.doesNotMatch(firstLine, /\+/);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("CLI tolerates added_dirs: null without crashing", async (t) => {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/transcript-render.jsonl", import.meta.url),
  );
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-home-"));
  const projectDir = path.join(homeDir, "dev", "apps", "my-project");
  await import("node:fs/promises").then((fs) =>
    fs.mkdir(projectDir, { recursive: true }),
  );
  try {
    const stdin = JSON.stringify({
      model: { display_name: "Opus" },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 45000 },
      },
      transcript_path: fixturePath,
      cwd: projectDir,
      workspace: { added_dirs: null },
    });

    const result = spawnSync("node", ["dist/index.js"], {
      cwd: path.resolve(process.cwd()),
      input: stdin,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, LANG: "C" },
    });

    if (skipIfSpawnBlocked(result, t)) return;

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || "non-zero exit");
    const firstLine = stripAnsi(result.stdout).split("\n")[0];
    assert.doesNotMatch(firstLine, /\+/);
    assert.doesNotMatch(stripAnsi(result.stdout), /Added dirs:/);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("CLI ignores non-string and post-sanitize-empty added_dirs entries", async (t) => {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/transcript-render.jsonl", import.meta.url),
  );
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-home-"));
  const projectDir = path.join(homeDir, "dev", "apps", "my-project");
  const validA = path.join(homeDir, "dev", "apps", "valid-one");
  const validB = path.join(homeDir, "dev", "apps", "valid-two");
  await import("node:fs/promises").then((fs) =>
    Promise.all([
      fs.mkdir(projectDir, { recursive: true }),
      fs.mkdir(validA, { recursive: true }),
      fs.mkdir(validB, { recursive: true }),
    ]),
  );
  try {
    const stdin = JSON.stringify({
      model: { display_name: "Opus" },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 45000 },
      },
      transcript_path: fixturePath,
      cwd: projectDir,
      workspace: {
        added_dirs: [validA, null, 42, "", { foo: 1 }, "‎", validB],
      },
    });

    const result = spawnSync("node", ["dist/index.js"], {
      cwd: path.resolve(process.cwd()),
      input: stdin,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, LANG: "C" },
    });

    if (skipIfSpawnBlocked(result, t)) return;

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || "non-zero exit");
    const firstLine = stripAnsi(result.stdout).split("\n")[0];
    assert.match(firstLine, /\+valid-one/);
    assert.match(firstLine, /\+valid-two/);
    const plusCount = (firstLine.match(/\+valid-/g) || []).length;
    assert.equal(plusCount, 2, "only the two valid basenames should render");
    assert.doesNotMatch(firstLine, /\+ /, "no bare '+' from control-char-only basename");
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("CLI prints initializing message on empty stdin", async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-home-"));

  try {
    const result = spawnSync("node", ["dist/index.js"], {
      cwd: path.resolve(process.cwd()),
      input: "",
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, LANG: "C" },
    });

    if (skipIfSpawnBlocked(result, t)) return;

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || "non-zero exit");
    const normalized = stripAnsi(result.stdout)
      .replace(/\u00A0/g, " ")
      .trimEnd();
    assert.ok(
      normalized.startsWith("[claude-hud] Initializing..."),
      `unexpected output: ${normalized}`,
    );
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
