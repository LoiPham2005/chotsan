import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceService } from "./device.service";

/**
 * Thiết bị nhận push. Loại lỗi đắt nhất: lộ `fcmToken` ra response (ai có token
 * là đẩy được thông báo tới máy đó), và hai endpoint trả hai hình dạng khác nhau
 * cho CÙNG một kiểu `Device` trong đặc tả — client sinh tự động giải mã hỏng.
 */

const DEVICE = {
  id: "d1",
  platform: "ANDROID" as const,
  deviceName: "Pixel",
  lastSeenAt: new Date("2026-09-04T08:00:00+07:00"),
  createdAt: new Date("2026-09-01T08:00:00+07:00"),
};

type SelectArgs = { select: Record<string, boolean> };

function createDb() {
  const db = {
    userDevice: {
      upsert: vi.fn((_args: SelectArgs) => Promise.resolve(DEVICE)),
      findMany: vi.fn((_args: SelectArgs) => Promise.resolve([DEVICE])),
    },
  };
  return { db: db as unknown as PrismaClient, mock: db };
}

beforeEach(() => vi.clearAllMocks());

describe("register / listActive — hình dạng trả về", () => {
  it("register và listActive chọn CÙNG bộ trường, có createdAt", async () => {
    const { db, mock } = createDb();
    const service = new DeviceService(db);

    await service.register("u1", { platform: "ANDROID", fcmToken: "tok" });
    await service.listActive("u1");

    const registerSelect = mock.userDevice.upsert.mock.calls[0]![0].select;
    const listSelect = mock.userDevice.findMany.mock.calls[0]![0].select;
    expect(registerSelect).toEqual(listSelect);
    expect(registerSelect).toHaveProperty("createdAt", true);
  });

  it("KHÔNG bao giờ trả fcmToken", async () => {
    const { db, mock } = createDb();

    await new DeviceService(db).register("u1", { platform: "IOS", fcmToken: "tok" });

    expect(mock.userDevice.upsert.mock.calls[0]![0].select).not.toHaveProperty("fcmToken");
  });
});
