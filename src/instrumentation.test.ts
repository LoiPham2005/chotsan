import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestError } from "./instrumentation";

/**
 * Dòng nhắc "khởi động lại pnpm dev" — xem chú thích trong instrumentation.ts.
 *
 * Nhắc SAI chỗ cũng hại như không nhắc: mọi lỗi đều kèm câu "khởi động lại" thì
 * người ta học được cách lờ nó đi. Nên chỉ đúng lỗi Prisma không biết trường.
 */

const REQUEST = { path: "/venues/san-a", method: "POST", headers: {} };
const CONTEXT = {
  routerKind: "App Router",
  routePath: "/venues/[slug]",
  routeType: "action",
  renderSource: "react-server-components",
  revalidateReason: undefined,
  renderType: "dynamic",
} as const;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("onRequestError — nhắc Prisma Client cũ", () => {
  it("lỗi `Unknown argument` của Prisma thì in lời nhắc khởi động lại", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await onRequestError(
      new Error("Invalid `prisma.booking.create()` invocation: Unknown argument `checkoutCode`."),
      REQUEST,
      CONTEXT,
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("pnpm dev");
  });

  it("lỗi khác thì im lặng", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await onRequestError(new Error("Can't reach database server"), REQUEST, CONTEXT);
    await onRequestError("không phải Error", REQUEST, CONTEXT);

    expect(warn).not.toHaveBeenCalled();
  });

  it("production thì không nhắc — build mới luôn nạp client mới nhất", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await onRequestError(new Error("Unknown argument `checkoutCode`"), REQUEST, CONTEXT);

    expect(warn).not.toHaveBeenCalled();
  });
});
