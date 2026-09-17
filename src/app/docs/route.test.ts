import { describe, expect, it } from "vitest";
import { GET } from "./route";

/**
 * Trang `/docs` (Scalar) chỉ là vỏ: nó tải đặc tả từ một URL. Trỏ sai URL thì
 * trang vẫn 200, chỉ là hiện "không tải được tài liệu" — không lớp kiểm nào
 * khác thấy. URL phải đi qua `apiPath`, không viết cứng `/api/v1`.
 */
describe("GET /docs", () => {
  it("trỏ tới đặc tả thật /api/v1/openapi.json", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/html/);
    expect(await response.text()).toContain("/api/v1/openapi.json");
  });
});
