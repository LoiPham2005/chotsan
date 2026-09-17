import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError, apiErrors, apiOk, handleApiError, parseJsonBody } from "./response";
import {
  DuplicateFieldError,
  InvalidCredentialsError,
  RefreshTokenReuseError,
  TooManyTwoFactorAttemptsError,
  UserNotFoundError,
} from "@/lib/errors";

type ErrorBody = { error: { code: string; message: string; fields?: Record<string, string[]> } };

async function bodyOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("apiOk", () => {
  it("bọc dữ liệu trong khoá data", async () => {
    const response = apiOk({ id: "1" });

    expect(response.status).toBe(200);
    await expect(bodyOf(response)).resolves.toEqual({ data: { id: "1" } });
  });
});

describe("handleApiError", () => {
  it("ánh xạ lỗi nghiệp vụ sang đúng status", async () => {
    const cases = [
      { error: new DuplicateFieldError("email", "a@b.com"), status: 409, code: "CONFLICT" },
      { error: new UserNotFoundError("x"), status: 404, code: "NOT_FOUND" },
      { error: new InvalidCredentialsError(), status: 401, code: "UNAUTHENTICATED" },
      { error: new RefreshTokenReuseError("u-1"), status: 401, code: "UNAUTHENTICATED" },
    ];

    for (const { error, status, code } of cases) {
      const response = handleApiError(error);
      expect(response.status).toBe(status);
      expect((await bodyOf<ErrorBody>(response)).error.code).toBe(code);
    }
  });

  it("không để lộ chi tiết lỗi lạ ra ngoài", async () => {
    const response = handleApiError(new Error("Prisma: connection string postgres://user:pw@host"));

    expect(response.status).toBe(500);
    const body = await bodyOf<ErrorBody>(response);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("postgres://");
  });

  it("giữ nguyên fields của lỗi validation", async () => {
    const response = handleApiError(apiErrors.validation({ email: ["Email không hợp lệ"] }));

    expect(response.status).toBe(422);
    expect((await bodyOf<ErrorBody>(response)).error.fields).toEqual({
      email: ["Email không hợp lệ"],
    });
  });
});

describe("parseJsonBody", () => {
  const schema = z.object({ email: z.email(), age: z.number().optional() });

  it("trả dữ liệu đã parse khi hợp lệ", async () => {
    await expect(parseJsonBody(jsonRequest({ email: "a@b.com" }), schema)).resolves.toEqual({
      email: "a@b.com",
    });
  });

  it("ném 422 kèm lỗi từng field", async () => {
    const caught: unknown = await parseJsonBody(jsonRequest({ email: "sai" }), schema).then(
      () => null,
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(ApiError);
    if (!(caught instanceof ApiError)) return;

    expect(caught.status).toBe(422);
    expect(caught.code).toBe("VALIDATION_ERROR");
    expect(caught.fields?.email?.[0]).toBeTypeOf("string");
  });

  it("ném 400 khi body không phải JSON", async () => {
    await expect(parseJsonBody(jsonRequest("{ khong phai json"), schema)).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});

describe("429 kèm Retry-After", () => {
  it("rate limit theo IP: header nói đúng số giây phải chờ", () => {
    // Không có header thì app mobile chỉ còn cách đoán — thường là thử lại
    // ngay, và tự kéo dài lệnh chặn của chính mình.
    const response = handleApiError(apiErrors.rateLimited(42));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
  });

  it("lỗi nghiệp vụ RATE_LIMITED mang số giây (bộ đếm 2FA theo tài khoản) cũng có header", () => {
    const response = handleApiError(new TooManyTwoFactorAttemptsError(600));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("600");
  });

  it("lỗi không phải 429 thì không có Retry-After", () => {
    expect(handleApiError(new UserNotFoundError()).headers.get("Retry-After")).toBeNull();
  });
});
