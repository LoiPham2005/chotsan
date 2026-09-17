import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";

/**
 * Cấm chạm Prisma ngoài tầng service. Tách thành hằng vì nó phải có mặt trong
 * MỌI khối `no-restricted-imports`: ESLint flat config không GỘP tuỳ chọn của
 * cùng một luật giữa hai khối — khối sau THAY hẳn khối trước cho những tệp khớp
 * cả hai. Khối "phân quyền theo sân" mà quên chép danh sách này là khu quản lý
 * sân được import Prisma trở lại, trong im lặng.
 */
const PRISMA_IMPORT_RESTRICTIONS = [
  {
    name: "@/lib/prisma",
    message:
      "Route/Action không query database trực tiếp. Thêm method vào src/services/*.ts rồi gọi service.",
  },
  {
    name: "@prisma/client",
    importNames: ["PrismaClient"],
    message:
      "Chỉ src/services/* và src/lib/prisma.ts được dựng PrismaClient. Type Prisma thì import type là được.",
  },
];

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "coverage/**",
      "realtime/dist/**",
      "worker/dist/**",
      "next-env.d.ts",
      "*.tsbuildinfo",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // Bật type-aware linting. Các rule quan trọng nhất
        // (no-floating-promises, no-misused-promises) chỉ chạy được khi
        // ESLint có thông tin kiểu.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Rules của Next.js + React Hooks — trước đây thiếu hoàn toàn.
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    plugins: {
      "@next/next": nextPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
    },
  },

  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // Promise bị quên await là nguồn bug số 1 trong Server Actions.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // Script chạy bằng Node (seed, kiểm tra tay) được phép log thoải mái.
  {
    files: ["prisma/**/*.ts", "scripts/**/*.ts"],
    rules: { "no-console": "off" },
  },

  /*
   * RANH GIỚI TẦNG, ép bằng máy.
   *
   * Route handler và Server Action KHÔNG được chạm Prisma — mọi truy vấn đi
   * qua `src/services/*.ts`. Không có luật này thì ranh giới chỉ là kỷ luật,
   * và kỷ luật thì rò rỉ: mỗi lần "lần này query nhanh gọn thôi mà" là một
   * chỗ nghiệp vụ nằm ngoài chỗ nó phải nằm, không test được và không tái
   * dùng được cho worker hay REST API.
   *
   * Đây chính là thứ mà bộ khung monorepo mua được bằng cách tách package.
   * Ở đây mua bằng 10 dòng cấu hình.
   */
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}", "realtime/**/*.ts"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { paths: PRISMA_IMPORT_RESTRICTIONS }],
    },
  },

  /*
   * PHÂN QUYỀN THEO SÂN, ép bằng máy.
   *
   * Trong khu quản lý sân, `defineAction` và `requireApiPermission` TRẦN là
   * sai: chúng hỏi "có quyền huỷ booking không" mà không nói booking của sân
   * nào. Bản cũ của dự án dính đúng lỗi này ở 27/29 service — nhân viên sân A
   * thao tác được lên sân B.
   *
   * Luật dưới đây làm việc quên kiểm sân thành lỗi biên dịch, không phải thứ
   * phải nhớ.
   *
   * ⚠️ Bản trước nhắm `src/app/(venue)/**` — thư mục KHÔNG tồn tại (khu sân thật
   * là `(manage)/manage/[venueId]`), nên luật chưa từng chặn được gì. `[` `]`
   * trong glob là lớp ký tự, phải thoát bằng `\\`. Cố ý KHÔNG phủ
   * `(manage)/manage/new/**`: trang đăng ký cơ sở mới chưa có sân nào để kiểm,
   * dùng `defineAuthedAction` là đúng.
   */
  {
    files: ["src/app/(manage)/manage/\\[venueId\\]/**/*.{ts,tsx}", "src/app/api/v1/venues/**/*.ts"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...PRISMA_IMPORT_RESTRICTIONS,
            {
              name: "@/lib/define-action",
              importNames: ["defineAction", "defineAuthedAction", "definePublicAction"],
              message:
                "Khu quản lý sân phải dùng defineVenueAction(permission, handler) — nó bắt truyền venueId và tự gọi canOnVenue.",
            },
            {
              name: "@/lib/api/auth",
              importNames: ["requireApiPermission"],
              message:
                "Route thuộc phạm vi sân phải dùng requireVenuePermission(request, venueId, permission).",
            },
          ],
        },
      ],
    },
  },

  // File test.
  {
    files: ["**/*.test.{ts,tsx}", "vitest.setup.ts", "test/**/*.ts"],
    rules: {
      // `vi.mocked(prisma.user.create)` là cách dùng đúng và bắt buộc của
      // vitest, nhưng rule này đọc nó thành method bị tách khỏi object.
      "@typescript-eslint/unbound-method": "off",

      // `expect.any(Date)`, `expect.objectContaining(...)` được vitest khai
      // kiểu trả về là `any` — đó là bản chất của matcher bất đối xứng, không
      // phải chỗ mất kiểu do viết ẩu. Rule này chỉ có ý nghĩa với code thật.
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },

  // File config và script .mjs/.cjs — chạy bằng Node, không nằm trong chương
  // trình TypeScript nên không lint theo kiểu được.
  {
    files: ["**/*.mjs", "**/*.js", "**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        // .cjs (vd ecosystem.config.cjs cho PM2) dùng CommonJS, không phải ESM.
        module: "writable",
        exports: "writable",
        require: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
    rules: { "no-console": "off" },
  },

  // Luôn để cuối: tắt mọi rule xung đột với Prettier.
  prettierConfig,
);
