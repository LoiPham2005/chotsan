import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  BookingNotFoundError,
  BookingStateError,
  ReviewNotFoundError,
  ReviewRatingError,
} from "@/lib/errors";
import { ReviewService } from "./review.service";

/**
 * Đánh giá là thứ quyết định sân nào được đặt. Nếu ai cũng chấm được thì đối
 * thủ mở mười tài khoản là dìm xong một sân trong một buổi tối; còn nếu điểm
 * trung bình lệch với bảng đánh giá thì sân hiện 4.8 sao trong khi thật là 3.1.
 *
 * Mốc: 04/09/2026.
 */

const NOW = new Date("2026-09-04T12:00:00Z");
const FINISHED_BOOKING = {
  id: "b1",
  venueId: "v1",
  status: "COMPLETED",
  endAt: new Date("2026-09-04T10:00:00Z"),
  review: null,
};

/** Đánh giá có sẵn trong database — mock `findFirst` lọc THẬT theo `where`. */
const REVIEWS = [
  { id: "r1", venueId: "v1" },
  { id: "r2", venueId: "v2" },
];

function createDb(booking: Partial<typeof FINISHED_BOOKING> | null = {}) {
  const db = {
    booking: {
      findFirst: vi
        .fn()
        .mockResolvedValue(booking === null ? null : { ...FINISHED_BOOKING, ...booking }),
    },
    review: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "r-new", ...data }),
      ),
      findFirst: vi.fn(({ where }: { where: { id: string; venueId: string } }) =>
        Promise.resolve(
          REVIEWS.find((review) => review.id === where.id && review.venueId === where.venueId) ??
            null,
        ),
      ),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "r1", ...data }),
      ),
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _avg: { rating: 4.25 }, _count: { _all: 4 } }),
    },
    venue: { update: vi.fn().mockResolvedValue({}) },
    $queryRaw: vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) =>
      Promise.resolve([{ id: "v1" }]),
    ),
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(db))),
  };
  return { db: db as unknown as PrismaClient, mock: db };
}

const input = { bookingId: "b1", userId: "u1", rating: 5, now: NOW };

beforeEach(() => vi.clearAllMocks());

describe("create — khách chấm sao", () => {
  it("ghi đánh giá gắn với lượt đặt đã chơi", async () => {
    const { db, mock } = createDb();
    await new ReviewService(db).create({ ...input, comment: "  Sân đẹp  " });

    expect(mock.review.create.mock.calls[0]![0].data).toMatchObject({
      venueId: "v1",
      bookingId: "b1",
      userId: "u1",
      rating: 5,
      comment: "Sân đẹp",
    });
  });

  it("bình luận trắng thì lưu null, không lưu chuỗi rỗng", async () => {
    const { db, mock } = createDb();
    await new ReviewService(db).create({ ...input, comment: "   " });

    expect(mock.review.create.mock.calls[0]![0].data.comment).toBeNull();
  });

  /**
   * Ràng buộc quan trọng nhất của cả tệp: không có nó thì điểm sao vô nghĩa.
   */
  it("không đánh giá được lượt đặt của người khác", async () => {
    const { db, mock } = createDb(null);

    await expect(new ReviewService(db).create(input)).rejects.toBeInstanceOf(BookingNotFoundError);
    expect(mock.review.create).not.toHaveBeenCalled();
    // Câu truy vấn ràng buộc CẢ id LẪN userId — không phải kiểm rời sau đó.
    const [{ where }] = mock.booking.findFirst.mock.calls[0] as [
      { where: { id: string; userId: string } },
    ];
    expect(where).toMatchObject({ id: "b1", userId: "u1" });
  });

  it("không đánh giá hai lần cho một lượt đặt", async () => {
    const { db } = createDb({ review: { id: "r0" } as never });

    await expect(new ReviewService(db).create(input)).rejects.toThrow("đã đánh giá");
  });

  it("chưa đá xong thì chưa chấm được", async () => {
    const { db } = createDb({ endAt: new Date("2026-09-04T14:00:00Z") });

    await expect(new ReviewService(db).create(input)).rejects.toThrow("Chơi xong rồi");
  });

  it("lượt đã huỷ hoặc chưa tới sân thì không chấm được", async () => {
    for (const status of ["CANCELLED", "EXPIRED", "CONFIRMED", "NO_SHOW"]) {
      const { db } = createDb({ status });
      await expect(new ReviewService(db).create(input)).rejects.toBeInstanceOf(BookingStateError);
    }
  });

  it("điểm ngoài 1–5 bị chặn", async () => {
    for (const rating of [0, 6, -1, 99]) {
      const { db } = createDb();
      await expect(new ReviewService(db).create({ ...input, rating })).rejects.toBeInstanceOf(
        ReviewRatingError,
      );
    }
  });

  /**
   * Lỗi thật trước đây: kiểm SAU `Math.round`. `Math.round(NaN)` là NaN và
   * `NaN < 1 || NaN > 5` là false — điểm NaN lọt thẳng xuống database; còn 4.6
   * được làm tròn thành 5, tức là tự chấm hộ khách thêm một điểm.
   */
  it("điểm phải là SỐ NGUYÊN — từ chối NaN, Infinity và số lẻ, trước khi đọc database", async () => {
    for (const rating of [Number.NaN, Infinity, -Infinity, 4.6, 1.5, 0.9, 5.0000001]) {
      const { db, mock } = createDb();

      await expect(
        new ReviewService(db).create({ ...input, rating }),
        String(rating),
      ).rejects.toBeInstanceOf(ReviewRatingError);
      expect(mock.booking.findFirst).not.toHaveBeenCalled();
      expect(mock.review.create).not.toHaveBeenCalled();
    }
  });

  /**
   * `ratingAvg` là dữ liệu dẫn xuất. Để nó lệch với bảng `reviews` là sân hiện
   * 4.8 sao trong khi thực tế 3.1, và không ai lần ra vì sao.
   */
  it("tính lại điểm trung bình của sân trong CÙNG transaction", async () => {
    const { db, mock } = createDb();
    await new ReviewService(db).create(input);

    expect(mock.$transaction).toHaveBeenCalledTimes(1);
    expect(mock.review.aggregate).toHaveBeenCalledTimes(1);
    const [{ data }] = mock.venue.update.mock.calls[0] as [{ data: Record<string, number> }];
    expect(data).toEqual({ ratingAvg: 4.25, ratingCount: 4 });
  });

  /**
   * Hai khách gửi đánh giá cùng lúc: không khoá thì mỗi bên tính trung bình từ
   * ảnh chụp không thấy đánh giá của bên kia, bên ghi sau đè mất phần bên trước.
   */
  it("KHOÁ dòng cơ sở trước khi ghi đánh giá và trước khi tính lại điểm", async () => {
    const { db, mock } = createDb();
    await new ReviewService(db).create(input);

    const [strings, venueId] = mock.$queryRaw.mock.calls[0]!;
    expect(strings.join("?")).toMatch(/FROM venues WHERE id = \? FOR NO KEY UPDATE/);
    expect(venueId).toBe("v1");

    const lockedAt = mock.$queryRaw.mock.invocationCallOrder[0]!;
    expect(lockedAt).toBeLessThan(mock.review.create.mock.invocationCallOrder[0]!);
    expect(lockedAt).toBeLessThan(mock.review.aggregate.mock.invocationCallOrder[0]!);
  });

  it("sân chưa có đánh giá nào thì điểm về 0, không phải null", async () => {
    const { db, mock } = createDb();
    mock.review.aggregate.mockResolvedValue({ _avg: { rating: null }, _count: { _all: 0 } });

    await new ReviewService(db).create(input);

    const [{ data }] = mock.venue.update.mock.calls[0] as [{ data: Record<string, number> }];
    expect(data).toEqual({ ratingAvg: 0, ratingCount: 0 });
  });
});

describe("reply — chủ sân trả lời", () => {
  it("ghi lời đáp và mốc thời gian", async () => {
    const { db, mock } = createDb();
    await new ReviewService(db).reply({
      reviewId: "r1",
      venueId: "v1",
      reply: "  Cảm ơn bạn  ",
      now: NOW,
    });

    expect(mock.review.update.mock.calls[0]![0].data).toEqual({
      ownerReply: "Cảm ơn bạn",
      ownerRepliedAt: NOW,
    });
  });

  it("không trả lời được đánh giá của sân khác — lọc theo venueId NGAY trong câu truy vấn", async () => {
    // `r2` có thật, nhưng thuộc sân v2. Mock lọc thật theo `where`, nên bài chỉ
    // xanh khi service đưa `venueId` vào câu truy vấn.
    const { db, mock } = createDb();

    await expect(
      new ReviewService(db).reply({ reviewId: "r2", venueId: "v1", reply: "x" }),
    ).rejects.toBeInstanceOf(ReviewNotFoundError);
    expect(mock.review.findFirst.mock.calls[0]![0].where).toEqual({ id: "r2", venueId: "v1" });
    expect(mock.review.update).not.toHaveBeenCalled();
  });

  it("đánh giá không tồn tại thì báo 'Không tìm thấy đánh giá', không nói về lượt đặt", async () => {
    const { db } = createDb();

    await expect(
      new ReviewService(db).reply({ reviewId: "missing-review", venueId: "v1", reply: "x" }),
    ).rejects.toThrow("Không tìm thấy đánh giá");
  });
});
