import { describe, expect, it } from "vitest";
import {
  assertUploadAllowed,
  buildStorageKey,
  hashFile,
  IMAGE_UPLOAD,
  UploadRejectedError,
} from "./storage";

/** Dựng buffer có magic bytes của một định dạng ảnh thật. */
function fakeImage(type: "jpeg" | "png" | "gif" | "webp", size = 64): Buffer {
  const buffer = Buffer.alloc(size);

  if (type === "jpeg") buffer.set([0xff, 0xd8, 0xff], 0);
  if (type === "png") buffer.set([0x89, 0x50, 0x4e, 0x47], 0);
  if (type === "gif") buffer.write("GIF8", 0, "ascii");
  if (type === "webp") {
    buffer.write("RIFF", 0, "ascii");
    buffer.write("WEBP", 8, "ascii");
  }

  return buffer;
}

describe("buildStorageKey", () => {
  it("KHÔNG giữ tên file gốc", () => {
    const key = buildStorageKey("Ảnh Của Tôi.png");

    // Tên do người dùng đặt là dữ liệu không tin được. Giữ lại nó làm khoá là
    // mở đường cho đủ thứ: trùng tên, ký tự lạ, và tệ nhất là đường dẫn.
    expect(key).not.toContain("Ảnh");
    expect(key.endsWith(".png")).toBe(true);
  });

  it("chặn path traversal trong TÊN FILE", () => {
    const key = buildStorageKey("../../../etc/passwd");

    expect(key).not.toContain("..");
    expect(key).not.toContain("/etc/");
  });

  it("chặn path traversal trong THƯ MỤC", () => {
    const key = buildStorageKey("a.png", "../../secret");

    expect(key).not.toContain("..");
  });

  it("bỏ phần mở rộng lạ thay vì giữ nguyên", () => {
    // `.php%00` là kỹ thuật cũ nhưng vẫn xuất hiện: chèn byte null để qua mặt
    // bộ lọc phần mở rộng.
    const key = buildStorageKey("shell.php%00.png");

    expect(key).not.toContain("%00");
  });

  it("hai lần gọi cho ra hai khoá khác nhau", () => {
    expect(buildStorageKey("a.png")).not.toBe(buildStorageKey("a.png"));
  });
});

describe("assertUploadAllowed", () => {
  it("cho qua ảnh hợp lệ", () => {
    expect(() => {
      assertUploadAllowed(fakeImage("png"), "image/png", IMAGE_UPLOAD);
    }).not.toThrow();
  });

  it("từ chối file rỗng", () => {
    expect(() => {
      assertUploadAllowed(Buffer.alloc(0), "image/png", IMAGE_UPLOAD);
    }).toThrow(UploadRejectedError);
  });

  it("từ chối file quá lớn", () => {
    const tooBig = Buffer.alloc(IMAGE_UPLOAD.maxBytes + 1);
    tooBig.set([0x89, 0x50, 0x4e, 0x47], 0);

    expect(() => {
      assertUploadAllowed(tooBig, "image/png", IMAGE_UPLOAD);
    }).toThrow(/vượt quá/);
  });

  it("từ chối định dạng không nằm trong danh sách trắng", () => {
    expect(() => {
      assertUploadAllowed(fakeImage("png"), "application/x-msdownload", IMAGE_UPLOAD);
    }).toThrow(/không được chấp nhận/);
  });

  /**
   * Bài test quan trọng nhất của file này.
   *
   * `File.type` do TRÌNH DUYỆT khai báo, và trình duyệt suy ra nó từ phần mở
   * rộng. Đổi tên `virus.exe` thành `anh.png` là đủ để `type` thành
   * `image/png` — nên chỉ kiểm `type` là không kiểm gì cả.
   */
  it("từ chối file KHÔNG phải ảnh dù khai là ảnh", () => {
    const notAnImage = Buffer.from("MZ\x90\x00 đây là file thực thi, không phải ảnh");

    // Bản đầu của `assertUploadAllowed` để lọt đúng ca này: nó chỉ đối chiếu
    // KHI nhận diện được định dạng, mà file thực thi thì không nhận diện được
    // nên rơi vào nhánh "bỏ qua". Danh sách trắng đảo lại logic đó — với ảnh,
    // "không chứng minh được là ảnh" nghĩa là từ chối.
    expect(() => {
      assertUploadAllowed(notAnImage, "image/png", IMAGE_UPLOAD);
    }).toThrow(/không phải ảnh hợp lệ/);
  });

  it("phát hiện cả khi đổi giữa hai định dạng ảnh", () => {
    expect(() => {
      assertUploadAllowed(fakeImage("jpeg"), "image/png", IMAGE_UPLOAD);
    }).toThrow(/không khớp/);
  });

  it("nhận diện đúng cả bốn định dạng ảnh được hỗ trợ", () => {
    const cases = [
      ["jpeg", "image/jpeg"],
      ["png", "image/png"],
      ["gif", "image/gif"],
      ["webp", "image/webp"],
    ] as const;

    for (const [kind, mime] of cases) {
      expect(() => {
        assertUploadAllowed(fakeImage(kind), mime, IMAGE_UPLOAD);
      }, `${kind} phải được chấp nhận`).not.toThrow();
    }
  });
});

describe("hashFile", () => {
  it("cùng nội dung cho ra cùng hash — dùng để phát hiện file trùng", () => {
    const a = fakeImage("png");
    const b = fakeImage("png");

    expect(hashFile(a)).toBe(hashFile(b));
  });

  it("khác nội dung thì khác hash", () => {
    expect(hashFile(fakeImage("png"))).not.toBe(hashFile(fakeImage("jpeg")));
  });
});
