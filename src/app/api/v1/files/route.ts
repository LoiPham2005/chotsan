import { enforceRateLimit, requireApiPermission } from "@/lib/api/auth";
import { apiErrors, apiOk, handleApiError } from "@/lib/api/response";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { IMAGE_UPLOAD, UploadRejectedError, assertUploadAllowed, getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Tải tệp lên.
 *
 * ---
 * VÌ SAO KIỂM MAGIC BYTES CHỨ KHÔNG TIN `file.type`
 *
 * `Content-Type` trong multipart do CLIENT khai. Một tệp `.html` khai là
 * `image/png` sẽ qua mọi phép kiểm dựa trên chuỗi đó — và nếu kho lưu trữ phục
 * vụ file công khai, tên miền của bạn vừa thành nơi chứa trang lừa đảo.
 *
 * `assertUploadAllowed` đọc vài byte đầu của DỮ LIỆU THẬT. Với ảnh thì "không
 * chứng minh được là ảnh" = từ chối (danh sách trắng).
 */
export async function POST(request: Request) {
  try {
    await requireApiPermission(request, "file:upload");
    await enforceRateLimit(request, "api:upload", RATE_LIMITS.upload);

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");

    if (!(file instanceof File)) {
      throw apiErrors.validation({ file: ["Thiếu tệp trong trường `file`"] });
    }

    // Đọc TOÀN BỘ vào bộ nhớ: đó là cái giá của việc kiểm được nội dung thật.
    // Với tệp lớn (video, bản sao lưu) hãy chuyển sang presigned URL và cho
    // client `PUT` thẳng lên S3 — xem ghi chú đầu `src/lib/storage.ts`.
    const data = Buffer.from(await file.arrayBuffer());

    assertUploadAllowed(data, file.type, IMAGE_UPLOAD);

    const folderValue = form?.get("folder");
    const folder = typeof folderValue === "string" ? folderValue : undefined;

    const stored = await getStorage().put(data, file.name, {
      contentType: file.type,
      folder,
    });

    return apiOk({ file: stored }, 201);
  } catch (error) {
    // `UploadRejectedError` là lỗi của DỮ LIỆU gửi lên, không phải lỗi máy chủ.
    if (error instanceof UploadRejectedError) {
      return handleApiError(apiErrors.validation({ file: [error.message] }), {
        route: "POST /api/v1/files",
        request,
      });
    }
    return handleApiError(error, { route: "POST /api/v1/files", request });
  }
}
