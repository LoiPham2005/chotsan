/**
 * Sinh chuỗi VietQR theo chuẩn EMVCo — thuần tuý, không gọi mạng.
 *
 * ---
 * VÌ SAO TỰ SINH CHỨ KHÔNG DÙNG API img.vietqr.io
 *
 * Dịch vụ ảnh QR nhận qua URL: số tài khoản, tên chủ tài khoản, số tiền, nội
 * dung chuyển khoản. Toàn bộ thông tin thanh toán của chủ sân đi qua máy chủ
 * bên thứ ba và nằm lại trong log truy cập của họ. Ở đây chuỗi được dựng tại
 * máy chủ của ta, trình duyệt tự vẽ ra QR — không có ai ở giữa.
 *
 * Đổi lại phải tự tính CRC-16, tổng cộng khoảng 40 dòng.
 */

/** Mã BIN của các ngân hàng hay gặp. Tra đủ tại vietqr.io/danh-sach-api. */
export const BANK_BINS: Record<string, string> = {
  VCB: "970436",
  TCB: "970407",
  MB: "970422",
  ACB: "970416",
  VPB: "970432",
  BIDV: "970418",
  VTB: "970415",
  TPB: "970423",
  SCB: "970429",
  STB: "970403",
  HDB: "970437",
  OCB: "970448",
  MSB: "970426",
  SHB: "970443",
  EIB: "970431",
  AGB: "970405",
};

function tlv(id: string, value: string): string {
  return id + String(value.length).padStart(2, "0") + value;
}

/**
 * CRC-16/CCITT-FALSE — thuật toán mà đặc tả EMVCo quy định.
 *
 * Sai một bit ở đây thì mã QR vẫn hiện ra bình thường nhưng mọi app ngân hàng
 * đều từ chối quét, và không có thông báo lỗi nào để lần ra.
 */
function crc16(input: string): string {
  let crc = 0xffff;

  for (let index = 0; index < input.length; index += 1) {
    crc ^= input.charCodeAt(index) << 8;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Bỏ dấu và ký tự lạ khỏi nội dung chuyển khoản.
 *
 * Nhiều app ngân hàng Việt Nam từ chối hoặc cắt cụt nội dung có dấu. Mã đặt sân
 * bị cắt là tiền vào tài khoản mà không ai biết của lượt đặt nào.
 */
export function sanitizeTransferNote(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .trim()
    .slice(0, 25);
}

export type VietQrInput = {
  /** Mã BIN 6 số của ngân hàng nhận. Xem `BANK_BINS`. */
  bankBin: string;
  accountNumber: string;
  /** Đồng. Bỏ trống = QR không cố định số tiền, khách tự nhập. */
  amount?: number;
  /** Nội dung chuyển khoản — đây là thứ dùng để đối soát. */
  transferNote?: string;
};

/**
 * Chuỗi để vẽ thành mã QR. Truyền thẳng vào thư viện QR phía trình duyệt.
 *
 * Trả `null` khi thiếu dữ liệu bắt buộc — dựng một QR sai còn tệ hơn không dựng:
 * khách quét, chuyển tiền vào tài khoản không tồn tại, rồi mới phát hiện.
 */
export function buildVietQrPayload(input: VietQrInput): string | null {
  const bin = input.bankBin?.trim();
  const account = input.accountNumber?.trim();

  if (!/^\d{6}$/.test(bin ?? "")) return null;
  if (!account || !/^\d{4,19}$/.test(account)) return null;
  if (input.amount !== undefined && (!Number.isInteger(input.amount) || input.amount <= 0)) {
    return null;
  }

  // Định danh người nhận: BIN + số tài khoản, bọc trong khối của NAPAS.
  const beneficiary = tlv("00", bin) + tlv("01", account);
  const merchantAccount = tlv("00", "A000000727") + tlv("01", beneficiary) + tlv("02", "QRIBFTTA");

  const parts = [
    tlv("00", "01"),
    // "12" = QR dùng MỘT LẦN (có số tiền); "11" = dùng nhiều lần.
    tlv("01", input.amount === undefined ? "11" : "12"),
    tlv("38", merchantAccount),
    tlv("53", "704"), // VND theo ISO 4217
    ...(input.amount === undefined ? [] : [tlv("54", String(input.amount))]),
    tlv("58", "VN"),
    ...(input.transferNote ? [tlv("62", tlv("08", sanitizeTransferNote(input.transferNote)))] : []),
  ];

  // CRC tính trên toàn bộ chuỗi ĐÃ gồm "6304" — đúng theo đặc tả, và đây là chỗ
  // hay bị làm sai nhất khi tự viết.
  const withoutCrc = `${parts.join("")}6304`;

  return withoutCrc + crc16(withoutCrc);
}

/** Mã đối soát cho một lượt đặt: `CS` + mã đặt sân, đã bỏ dấu và ký tự lạ. */
export function transferNoteForBooking(bookingCode: string): string {
  return sanitizeTransferNote(`CS ${bookingCode}`);
}
