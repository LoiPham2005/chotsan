import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { AuditService } from "./audit.service";
import {
  AccountBannedError,
  AccountLockedError,
  InvalidCredentialsError,
  UserNotFoundError,
} from "@/lib/errors";

/**
 * Nhật ký là việc PHỤ: ghi hỏng thì mất một dòng, không được làm hỏng thao tác
 * người dùng vừa làm xong. Và nó chỉ tra cứu được khi ghi ĐÚNG thứ cần ghi.
 */

function createDb(create = vi.fn().mockResolvedValue({})) {
  return { db: { auditLog: { create } } as unknown as PrismaClient, create };
}

describe("AuditService.record", () => {
  it("database lỗi thì nuốt lỗi — không bao giờ ném ra", async () => {
    const { db } = createDb(vi.fn().mockRejectedValue(new Error("disk full")));

    await expect(
      new AuditService(db).record({ action: "x", entity: "user" }),
    ).resolves.toBeUndefined();
  });
});

describe("AuditService.recordLoginFailure", () => {
  const context = { method: "password", ip: "203.0.113.7", userAgent: "UA" };

  it("sai mật khẩu của tài khoản CÓ THẬT → một dòng LOGIN_FAILED đúng người", async () => {
    const { db, create } = createDb();

    await new AuditService(db).recordLoginFailure(new InvalidCredentialsError("u1"), context);

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "auth.login_failed",
        entityId: "u1",
        metadata: { method: "password", reason: "invalid_password" },
        ip: "203.0.113.7",
      }),
    });
  });

  it("đang khoá tạm hay bị khoá cũng ghi, kèm lý do", async () => {
    const { db, create } = createDb();
    const service = new AuditService(db);

    await service.recordLoginFailure(new AccountLockedError(new Date(), "u1"), context);
    await service.recordLoginFailure(new AccountBannedError("u2"), context);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]![0]).toMatchObject({
      data: { entityId: "u2", metadata: { reason: "banned" } },
    });
  });

  it("email KHÔNG tồn tại → không ghi gì: mỗi lượt dò mù thành một dòng rác", async () => {
    const { db, create } = createDb();
    const service = new AuditService(db);

    await service.recordLoginFailure(new InvalidCredentialsError(), context);
    await service.recordLoginFailure(new UserNotFoundError(), context);
    await service.recordLoginFailure(new Error("lạ"), context);

    expect(create).not.toHaveBeenCalled();
  });
});
