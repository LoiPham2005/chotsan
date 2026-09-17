import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/session";

/**
 * Chấm sao cho lượt đã chơi. Câu lỗi phải nói đúng Ô NÀO sai — bản trước báo
 * "Chọn số sao trước khi gửi" cho MỌI lỗi, kể cả khi đã chọn sao mà nhận xét dài
 * quá: người dùng bấm lại mãi mà không biết sửa chỗ nào.
 */

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/review.service", () => ({ reviewService: { create: vi.fn() } }));

import { getSession } from "@/lib/auth";
import { reviewService } from "@/services/review.service";
import { createReviewAction } from "./review-actions";

const SESSION: SessionPayload = { typ: "access", sub: "u1", email: "a@b.com", roles: ["USER"] };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(SESSION);
});

describe("createReviewAction", () => {
  it("chưa chọn sao: nhắc chọn sao", async () => {
    const result = await createReviewAction({}, form({ bookingId: "b1", rating: "0" }));

    expect(result.error).toBe("Chọn số sao trước khi gửi");
    expect(reviewService.create).not.toHaveBeenCalled();
  });

  it("đã chọn sao mà nhận xét quá dài: nói đúng là nhận xét, không nhắc chọn sao", async () => {
    const result = await createReviewAction(
      {},
      form({ bookingId: "b1", rating: "5", comment: "x".repeat(1001) }),
    );

    expect(result.error).toBe("Nhận xét tối đa 1000 ký tự — rút gọn lại giúp bạn nhé");
    expect(reviewService.create).not.toHaveBeenCalled();
  });

  it("hợp lệ thì gửi cho service theo người đang đăng nhập", async () => {
    vi.mocked(reviewService.create).mockResolvedValue(undefined as never);

    const result = await createReviewAction(
      {},
      form({ bookingId: "b1", rating: "4", comment: " Sân đẹp " }),
    );

    expect(result.ok).toBe("Cảm ơn bạn đã đánh giá");
    expect(reviewService.create).toHaveBeenCalledWith({
      bookingId: "b1",
      userId: "u1",
      rating: 4,
      comment: "Sân đẹp",
    });
  });
});
