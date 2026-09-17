/**
 * Dựng `node_modules` TỐI THIỂU cho image `worker` và `realtime` (xem Dockerfile).
 *
 * ---
 * VÌ SAO CẦN
 *
 * `pnpm worker:build` / `realtime:build` gói mã bằng esbuild với
 * `--packages=external`: mã của mình vào một tệp, còn gói npm vẫn `require` từ
 * `node_modules` lúc chạy. Image từng chỉ chép `dist/` → container chết ngay với
 * `Cannot find module 'bullmq'`, mà build vẫn xanh.
 *
 * Chép nguyên `node_modules` thì sai theo hướng khác: bản đủ ~1,5GB, bản
 * `--prod` ~760MB (kéo cả next, sharp, Prisma CLI…) cho một tiến trình chỉ cần vài gói.
 *
 * ---
 * HAI BƯỚC
 *
 *   manifest <metafile> <outDir>
 *     Chạy trong stage `builder` (có node_modules đầy đủ). Đọc metafile của
 *     esbuild → đúng các gói bundle `require`/`import()` → ghi `<outDir>/package.json`
 *     với phiên bản CHÍNH XÁC đang cài. Bundle dùng `@prisma/client` thì chép kèm
 *     Prisma Client đã generate (image không có Prisma CLI để generate lại).
 *
 *   finalize <runtimeDir> <rootLockfile>
 *     Chạy SAU `pnpm install` trong stage `*-deps`. Đặt Prisma Client vào đúng chỗ,
 *     từ chối mọi phiên bản không có trong pnpm-lock.yaml gốc (image không được
 *     mang gói chưa từng qua CI), và `require` thử từng gói — thiếu gì thì BUILD
 *     đỏ ngay, không đợi container chết lúc chạy.
 */
import { cpSync, existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { join, resolve } from "node:path";

/**
 * Gói mà một external nạp LƯỜI bên trong nó — metafile không thấy được.
 *
 * `bullmq` 6 chỉ `require("ioredis")` lúc dựng kết nối từ `{ url }`: thiếu gói này
 * thì worker khởi động bình thường rồi mọi kết nối Redis báo "could not load the
 * optional 'ioredis' package".
 */
const LAZY_PEERS = { bullmq: ["ioredis"] };

/** `@scope/name/sub/path` → `@scope/name`; `name/sub` → `name`. */
function packageName(importPath) {
  const parts = importPath.split("/");
  return importPath.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fail(message) {
  console.error(`✗ runtime-package: ${message}`);
  process.exit(1);
}

function manifest(metafilePath, outDir) {
  const root = process.cwd();
  const rootPackage = readJson(join(root, "package.json"));
  const meta = readJson(metafilePath);

  const names = new Set();
  for (const output of Object.values(meta.outputs)) {
    for (const entry of output.imports) {
      if (!entry.external || isBuiltin(entry.path)) continue;
      names.add(packageName(entry.path));
    }
  }
  for (const [name, peers] of Object.entries(LAZY_PEERS)) {
    if (names.has(name)) for (const peer of peers) names.add(peer);
  }

  const dependencies = {};
  for (const name of [...names].sort()) {
    // Gói devDependencies chạy được trên máy dev (đã cài đủ) nhưng không bao giờ
    // có ở production — chặn ngay tại đây thay vì để image chết lúc chạy.
    if (!rootPackage.dependencies?.[name]) {
      fail(`bundle cần "${name}" nhưng nó không nằm trong "dependencies" của package.json`);
    }
    dependencies[name] = readJson(join(root, "node_modules", name, "package.json")).version;
  }

  writeFileSync(
    join(outDir, "package.json"),
    `${JSON.stringify(
      {
        name: "chotsan-runtime",
        private: true,
        // Cùng bản pnpm và cùng `overrides` với gốc — lệch một trong hai là pnpm
        // coi lockfile gốc không hợp lệ và giải lại phiên bản từ đầu.
        packageManager: rootPackage.packageManager,
        dependencies,
        ...(rootPackage.pnpm?.overrides ? { pnpm: { overrides: rootPackage.pnpm.overrides } } : {}),
      },
      null,
      2,
    )}\n`,
  );

  if (dependencies["@prisma/client"]) {
    const clientDir = realpathSync(join(root, "node_modules", "@prisma", "client"));
    // prisma-client-js sinh client CẠNH gói `@prisma/client` đã resolve:
    // `<…>/node_modules/@prisma/client` ↔ `<…>/node_modules/.prisma/client`.
    const generated = resolve(clientDir, "..", "..", ".prisma", "client");
    if (!existsSync(join(generated, "default.js"))) {
      fail(`không thấy Prisma Client đã generate ở ${generated} — chạy pnpm db:generate trước`);
    }
    cpSync(generated, join(outDir, ".prisma-client"), { recursive: true });
  }

  console.log(`✓ runtime-package: ${Object.keys(dependencies).join(", ")}`);
}

/** Tập `tên@phiên-bản` trong mục `packages:` của pnpm-lock.yaml (định dạng v9). */
function lockfilePackages(path) {
  const text = readFileSync(path, "utf8");
  const start = text.indexOf("\npackages:\n");
  if (start === -1) fail(`${path} không có mục packages:`);

  const found = new Set();
  for (const line of text.slice(start + "\npackages:\n".length).split("\n")) {
    if (/^\S/.test(line)) break; // hết mục `packages:`
    const match = /^ {2}(?:'([^']+)'|([^\s'][^\s]*)):\s*$/.exec(line);
    if (match) found.add(match[1] ?? match[2]);
  }
  return found;
}

function finalize(runtimeDir, rootLockfile) {
  const dir = resolve(runtimeDir);
  const runtimePackage = readJson(join(dir, "package.json"));

  const staged = join(dir, ".prisma-client");
  if (existsSync(staged)) {
    const clientDir = realpathSync(join(dir, "node_modules", "@prisma", "client"));
    cpSync(staged, resolve(clientDir, "..", "..", ".prisma", "client"), { recursive: true });
    rmSync(staged, { recursive: true, force: true });
  }

  const allowed = lockfilePackages(rootLockfile);
  const drifted = [...lockfilePackages(join(dir, "pnpm-lock.yaml"))].filter(
    (entry) => !allowed.has(entry),
  );
  if (drifted.length > 0) {
    fail(`phiên bản KHÔNG có trong pnpm-lock.yaml gốc: ${drifted.join(", ")}`);
  }

  const requireFromRuntime = createRequire(join(dir, "package.json"));
  for (const name of Object.keys(runtimePackage.dependencies)) {
    try {
      requireFromRuntime(name);
    } catch (error) {
      fail(`require("${name}") hỏng: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // Gói nạp lười phải tìm thấy được TỪ CHÍNH vị trí của gói nạp nó.
  for (const [name, peers] of Object.entries(LAZY_PEERS)) {
    if (!runtimePackage.dependencies[name]) continue;
    const requireFromPackage = createRequire(requireFromRuntime.resolve(name));
    for (const peer of peers) requireFromPackage(peer);
  }

  console.log(
    `✓ runtime-package: require được ${Object.keys(runtimePackage.dependencies).length} gói`,
  );
}

const [command, ...args] = process.argv.slice(2);

if (command === "manifest" && args.length === 2) {
  manifest(args[0], args[1]);
} else if (command === "finalize" && args.length === 2) {
  finalize(args[0], args[1]);
} else {
  fail(
    "cách dùng: runtime-package.mjs manifest <metafile> <outDir> | finalize <runtimeDir> <rootLockfile>",
  );
}
