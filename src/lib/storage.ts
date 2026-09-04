import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isProduction } from "./env";
import { logger } from "./logger";

/**
 * Lưu trữ file.
 *
 * ---
 * VÌ SAO KHÔNG CẮM SẴN S3
 *
 * Cùng lý do với `mailer.ts` và `observability.ts`: mỗi dự án một ràng buộc.
 * Có nơi dùng Cloudflare R2, có nơi dùng Vietnix/Bizfly S3 để dữ liệu nằm
 * trong nước, có nơi khách bắt lưu trên chính máy chủ của họ. Cắm cứng một nhà
 * cung cấp chỉ tạo ra việc phải gỡ ra — cộng một SDK nặng mà nhiều dự án
 * không dùng.
 *
 * Thay vào đó: một interface hẹp, và một bản cài đặt ghi ra ĐĨA CỤC BỘ cho
 * môi trường dev.
 *
 * ---
 * ⚠️ BẢN GHI ĐĨA CỤC BỘ KHÔNG DÙNG ĐƯỢC TRÊN PRODUCTION
 *
 * Ba lý do, và cả ba đều là lỗi im lặng:
 *
 * 1. **Chạy nhiều instance thì file lạc.** Người dùng tải ảnh lên instance A,
 *    lần sau request rơi vào instance B — ảnh "biến mất".
 * 2. **Container không giữ dữ liệu.** Deploy lại là mất sạch file đã tải lên.
 * 3. **Không có CDN.** Mọi lượt xem ảnh đều đi qua tiến trình Node.
 *
 * Vì vậy trên production, bản mặc định **NÉM LỖI** thay vì âm thầm ghi vào một
 * thư mục sẽ bị xoá. Cùng thái độ với `mailer`: thà hỏng lúc deploy còn hơn
 * mất dữ liệu của người dùng vài tuần sau.
 */

export type StoredFile = {
  /** Khoá dùng để đọc/xoá về sau. Đây là thứ nên lưu vào database. */
  key: string;
  /** URL công khai, nếu nhà cung cấp có. Bản đĩa cục bộ trả đường dẫn tương đối. */
  url: string;
  size: number;
  contentType: string;
};

export type PutOptions = {
  contentType: string;
  /** Thư mục logic, ví dụ `avatars`. Không có thì file nằm ở gốc. */
  folder?: string;
};

export type Storage = {
  put(data: Buffer, originalName: string, options: PutOptions): Promise<StoredFile>;
  delete(key: string): Promise<void>;
  /**
   * URL tạm có chữ ký, dùng cho file RIÊNG TƯ.
   *
   * Không phải nhà cung cấp nào cũng hỗ trợ — trả `null` thì nơi gọi phải tự
   * phục vụ file qua route handler có kiểm quyền.
   */
  signedUrl?(key: string, expiresInSeconds: number): Promise<string | null>;
};

/**
 * Dựng khoá lưu trữ an toàn.
 *
 * Cố ý KHÔNG giữ tên file gốc làm khoá. Tên do người dùng đặt là dữ liệu không
 * tin được: nó có thể chứa `../` (thoát khỏi thư mục), ký tự Unicode gây rối,
 * hoặc trùng tên file người khác đã tải lên. Chỉ giữ lại phần mở rộng — và
 * cũng lọc luôn phần đó.
 */
export function buildStorageKey(originalName: string, folder?: string): string {
  const ext = extname(originalName).toLowerCase().slice(0, 10);
  const safeExt = /^\.[a-z0-9]+$/.test(ext) ? ext : "";

  const name = `${Date.now()}-${randomUUID()}${safeExt}`;

  // Thư mục cũng phải lọc: nơi gọi có thể vô tình truyền vào giá trị từ input.
  const safeFolder = folder?.replace(/[^a-z0-9/_-]/gi, "").replace(/^\/+|\/+$/g, "");

  return safeFolder ? `${safeFolder}/${name}` : name;
}

/** Thư mục ghi file khi chạy bản đĩa cục bộ. Nằm trong `public/` để Next phục vụ tĩnh. */
const LOCAL_DIR = join(process.cwd(), "public", "uploads");

const localDiskStorage: Storage = {
  async put(data, originalName, options) {
    if (isProduction) {
      throw new Error(
        "Chưa cấu hình Storage. Bản mặc định ghi ra đĩa cục bộ, KHÔNG dùng được " +
          "trên production: chạy nhiều instance thì file lạc, và deploy lại là mất sạch. " +
          "Gọi setStorage() với một nhà cung cấp thật (S3/R2/Vietnix) lúc khởi động.",
      );
    }

    const key = buildStorageKey(originalName, options.folder);
    const target = join(LOCAL_DIR, key);

    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, data);

    logger.warn("[storage:dev] Ghi file ra đĩa cục bộ — chỉ dùng cho môi trường dev", { key });

    return {
      key,
      url: `/uploads/${key}`,
      size: data.byteLength,
      contentType: options.contentType,
    };
  },

  async delete(key) {
    // Chặn `../` một lần nữa ngay trước khi chạm hệ thống file. Khoá lẽ ra do
    // `buildStorageKey` sinh ra, nhưng nó cũng có thể đến từ database — và dữ
    // liệu cũ trong database thì không ai bảo đảm được.
    if (key.includes("..")) throw new Error("Khoá lưu trữ không hợp lệ");

    await unlink(join(LOCAL_DIR, key)).catch(() => {
      // Xoá file không tồn tại không phải lỗi: người gọi muốn nó biến mất, và
      // nó đã biến mất rồi.
    });
  },
};

let currentStorage: Storage = localDiskStorage;

/** Cắm nhà cung cấp thật. Gọi một lần lúc khởi động ứng dụng. */
export function setStorage(storage: Storage): void {
  currentStorage = storage;
}

export function getStorage(): Storage {
  return currentStorage;
}

// ---------------------------------------------------------------------------
// Kiểm tra file tải lên
// ---------------------------------------------------------------------------

export type UploadRule = {
  /** Kích thước tối đa, tính bằng byte. */
  maxBytes: number;
  /** Danh sách MIME type cho phép. Dùng danh sách TRẮNG, không phải danh sách đen. */
  allowedTypes: readonly string[];
};

/** Bộ luật dựng sẵn cho ảnh — trường hợp phổ biến nhất. */
export const IMAGE_UPLOAD: UploadRule = {
  maxBytes: 5 * 1024 * 1024,
  allowedTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
};

export class UploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRejectedError";
  }
}

/**
 * Kiểm tra một file trước khi lưu.
 *
 * ---
 * VÌ SAO KHÔNG TIN `file.type`
 *
 * `File.type` do TRÌNH DUYỆT khai báo, và trình duyệt lấy nó từ phần mở rộng
 * tên file. Đổi `virus.exe` thành `anh.png` là đủ để `type` thành `image/png`.
 *
 * Vì vậy hàm này đọc thêm **magic bytes** — vài byte đầu của file, do chính
 * định dạng quy định và không đổi được bằng cách đổi tên. Không phải lớp phòng
 * thủ tuyệt đối (nhồi dữ liệu độc sau phần header vẫn được), nhưng nó chặn
 * đứng trường hợp phổ biến nhất.
 *
 * ⚠️ Chốt chặn thật sự vẫn là: KHÔNG BAO GIỜ phục vụ file người dùng tải lên
 * từ cùng tên miền với ứng dụng, và luôn set `Content-Disposition: attachment`
 * cho những gì không phải ảnh.
 */
export function assertUploadAllowed(data: Buffer, declaredType: string, rule: UploadRule): void {
  if (data.byteLength === 0) {
    throw new UploadRejectedError("File rỗng");
  }

  if (data.byteLength > rule.maxBytes) {
    const mb = (rule.maxBytes / 1024 / 1024).toFixed(1);
    throw new UploadRejectedError(`File vượt quá ${mb}MB`);
  }

  if (!rule.allowedTypes.includes(declaredType)) {
    throw new UploadRejectedError(`Định dạng ${declaredType} không được chấp nhận`);
  }

  const detected = detectImageType(data);

  /*
   * Khai là ảnh thì nội dung BẮT BUỘC phải là ảnh nhận diện được.
   *
   * Bản đầu của hàm này viết `if (detected && detected !== declaredType)` — tức
   * là chỉ đối chiếu KHI nhận diện được. Nghe hợp lý, nhưng nó để lọt đúng
   * trường hợp nguy hiểm nhất: một file thực thi (header `MZ`) khai là
   * `image/png` sẽ cho `detected === null`, và nhánh trên bỏ qua nó.
   *
   * Đảo lại thành danh sách trắng: với ảnh, `null` nghĩa là "không chứng minh
   * được đây là ảnh" → từ chối. Chính bài test
   * `src/lib/storage.test.ts` đã bắt được lỗ này.
   */
  if (declaredType.startsWith("image/")) {
    if (detected === null) {
      throw new UploadRejectedError("Nội dung file không phải ảnh hợp lệ");
    }
    if (detected !== declaredType) {
      throw new UploadRejectedError(
        `Nội dung file (${detected}) không khớp định dạng khai báo (${declaredType})`,
      );
    }
    return;
  }

  /*
   * Không phải ảnh thì chưa kiểm được nội dung — danh sách magic bytes ở dưới
   * chỉ phủ ảnh.
   *
   * ⚠️ Nghĩa là với PDF/zip/docx, `allowedTypes` là lớp bảo vệ DUY NHẤT, và nó
   * dựa vào giá trị do trình duyệt khai. Cho phép tải lên loại đó thì phải
   * phục vụ file từ một tên miền khác và luôn kèm
   * `Content-Disposition: attachment` — đừng trông vào hàm này.
   */
}

/** Nhận diện ảnh qua magic bytes. Trả `null` nếu không phải định dạng đã biết. */
function detectImageType(data: Buffer): string | null {
  if (data.length < 12) return null;

  // JPEG: FF D8 FF
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";

  // PNG: 89 50 4E 47
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "image/png";
  }

  // GIF: "GIF8"
  if (data.toString("ascii", 0, 4) === "GIF8") return "image/gif";

  // WebP: "RIFF" ở byte 0-3 và "WEBP" ở byte 8-11
  if (data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }

  return null;
}

/**
 * Băm nội dung file — dùng để phát hiện file trùng.
 *
 * Tải lên cùng một tấm ảnh mười lần thì lưu mười bản là lãng phí. Đối chiếu
 * hash trước khi ghi giải quyết được điều đó, đổi lại là một lượt đọc database.
 */
export function hashFile(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
