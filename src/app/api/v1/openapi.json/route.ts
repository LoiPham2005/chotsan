import { NextResponse } from "next/server";
import { getOpenApiDocument } from "@/lib/openapi/registry";

export const dynamic = "force-dynamic";

/**
 * Đặc tả OpenAPI cho `/api/v1/**`, sinh từ Zod schema thật (xem
 * `src/lib/openapi/registry.ts`) — không phải file viết tay có thể lệch dần
 * khỏi code.
 *
 * Trang tài liệu tương tác của chính app là `/docs` (Scalar, đọc URL này). Dán
 * URL vào Postman ("Import từ link") hoặc công cụ sinh client để dựng SDK mobile.
 */
export function GET() {
  return NextResponse.json(getOpenApiDocument());
}
