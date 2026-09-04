/**
 * Lỗi NGHIỆP VỤ, khai báo tập trung.
 *
 * ---
 * VÌ SAO KHÔNG GẮN MÃ HTTP NGAY TẠI CHỖ NÉM
 *
 * Tầng service không được biết gì về HTTP. Cùng một `UserNotFoundError` có thể
 * tới từ REST API (→ 404), từ một Server Action (→ hiện lỗi trên form), từ một
 * job nền (→ ghi log rồi bỏ qua), hoặc từ script CLI (→ in ra rồi thoát). Gắn
 * mã HTTP ngay tại chỗ ném là ép cả bốn nơi phải hiểu theo cách của nơi đầu.
 *
 * Việc ánh xạ sang HTTP nằm gọn trong `DOMAIN_STATUS` (`src/lib/api/response.ts`).
 *
 * ---
 * VÌ SAO CÓ `code`
 *
 * `code` là thứ client (Flutter/web) nên `switch` theo — nó là hợp đồng.
 * `message` để hiển thị cho người dùng và có thể đổi lời văn bất cứ lúc nào.
 * Client so sánh theo message là code sẽ hỏng ngay lần đầu ai đó sửa chính tả.
 */

export type DomainErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "ACCOUNT_BANNED"
  | "ACCOUNT_LOCKED"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "TWO_FACTOR_REQUIRED";

export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode;
  /** Lỗi theo từng trường, dùng cho VALIDATION_ERROR. */
  readonly fields?: Record<string, string[]>;

  protected constructor(message: string, fields?: Record<string, string[]>) {
    super(message);
    this.name = new.target.name;
    this.fields = fields;
  }
}

// ---------------------------------------------------------------------------
// Xác thực
// ---------------------------------------------------------------------------

/**
 * Dùng chung cho MỌI lý do đăng nhập hỏng: email không tồn tại, tài khoản chưa
 * đặt mật khẩu, sai mật khẩu.
 *
 * Gộp lại có chủ đích — phân biệt ba trường hợp là xác nhận cho người đang dò
 * biết tài khoản nào có thật.
 */
export class InvalidCredentialsError extends DomainError {
  readonly code = "UNAUTHENTICATED" as const;
  constructor() {
    super("Thông tin đăng nhập không chính xác");
  }
}

/** Khoá thủ công bởi admin (`UserStatus.BANNED`) — không tự hết hạn. */
export class AccountBannedError extends DomainError {
  readonly code = "ACCOUNT_BANNED" as const;
  constructor() {
    super("Tài khoản đã bị khoá. Vui lòng liên hệ quản trị viên.");
  }
}

/**
 * Tài khoản đang tạm ngưng (`UserStatus.INACTIVE`).
 *
 * Tách khỏi `AccountBannedError` vì thông điệp phải khác: BANNED là hình phạt
 * do vi phạm, INACTIVE chỉ là tạm dừng — người dùng cần biết họ nên hỏi ai để
 * mở lại, thay vì nghĩ mình đã làm gì sai.
 */
export class AccountInactiveError extends DomainError {
  readonly code = "ACCOUNT_BANNED" as const;
  constructor() {
    super("Tài khoản đang tạm ngưng hoạt động. Vui lòng liên hệ quản trị viên.");
  }
}

/** Khoá tạm tự động do sai mật khẩu liên tiếp — tự hết hạn tại `lockedUntil`. */
export class AccountLockedError extends DomainError {
  readonly code = "ACCOUNT_LOCKED" as const;
  constructor(readonly lockedUntil: Date) {
    super(
      `Tài khoản tạm khoá do đăng nhập sai quá nhiều lần. Thử lại sau ${Math.max(
        1,
        Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000),
      )} phút.`,
    );
  }
}

/**
 * Dùng chung cho mọi lý do token không dùng được: không tồn tại, sai loại, đã
 * dùng, hết hạn. Phân biệt "đã dùng" với "không tồn tại" là xác nhận cho người
 * hỏi biết token đó từng hợp lệ.
 */
export class InvalidVerificationTokenError extends DomainError {
  readonly code = "VALIDATION_ERROR" as const;
  constructor() {
    super("Liên kết không hợp lệ hoặc đã hết hạn");
  }
}

/**
 * Refresh token đã bị thu hồi nhưng vẫn được dùng lại.
 *
 * Chỉ có một cách giải thích hợp lý: nó đã bị đánh cắp. Không thể biết bên nào
 * là kẻ trộm, nên `TokenService` huỷ TOÀN BỘ phiên của tài khoản đó.
 */
export class RefreshTokenReuseError extends DomainError {
  readonly code = "UNAUTHENTICATED" as const;
  constructor(readonly userId: string) {
    super("Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.");
  }
}

export class InvalidRefreshTokenError extends DomainError {
  readonly code = "UNAUTHENTICATED" as const;
  constructor() {
    super("Refresh token không hợp lệ hoặc đã hết hạn");
  }
}

// ---------------------------------------------------------------------------
// Người dùng
// ---------------------------------------------------------------------------

export class UserNotFoundError extends DomainError {
  readonly code = "NOT_FOUND" as const;
  constructor(id?: string) {
    super(id ? `Không tìm thấy người dùng "${id}"` : "Không tìm thấy người dùng");
  }
}

export class DuplicateFieldError extends DomainError {
  readonly code = "CONFLICT" as const;
  constructor(field: "email" | "username" | "phone", value?: string) {
    const label = { email: "Email", username: "Tên đăng nhập", phone: "Số điện thoại" }[field];
    super(`${label}${value ? ` "${value}"` : ""} đã được sử dụng`, {
      [field]: [`${label} đã được sử dụng`],
    });
  }
}

/**
 * Chặn tự bắn vào chân mình: hạ quyền, khoá hoặc xoá CHÍNH tài khoản đang thao
 * tác. Không có chốt này thì quản trị viên cuối cùng của hệ thống tự khoá mình
 * ra ngoài chỉ bằng một cú bấm nhầm, và không còn ai vào sửa được.
 */
export class SelfActionForbiddenError extends DomainError {
  readonly code = "CONFLICT" as const;
  constructor(action: string) {
    super(`Bạn không thể tự ${action} chính tài khoản của mình`);
  }
}

// ---------------------------------------------------------------------------
// Vai trò & quyền
// ---------------------------------------------------------------------------

export class RoleNotFoundError extends DomainError {
  readonly code = "NOT_FOUND" as const;
  constructor(key: string) {
    super(`Không tìm thấy vai trò "${key}"`);
  }
}

/**
 * Vai trò gửi kèm khi tạo/sửa NGƯỜI DÙNG không tồn tại.
 *
 * Khác `RoleNotFoundError`: ở đây tài nguyên bị hỏi tới (user) không hề thiếu,
 * chỉ một trường trong body là sai — nên nó là lỗi validate (422), không phải
 * 404.
 */
export class UnknownRoleKeyError extends DomainError {
  readonly code = "VALIDATION_ERROR" as const;
  constructor(keys: string[]) {
    super(`Vai trò không tồn tại: ${keys.join(", ")}`, {
      roleKeys: [`Vai trò không tồn tại: ${keys.join(", ")}`],
    });
  }
}

export class RoleKeyAlreadyExistsError extends DomainError {
  readonly code = "CONFLICT" as const;
  constructor(key: string) {
    super(`Vai trò "${key}" đã tồn tại`);
  }
}

export class SystemRoleImmutableError extends DomainError {
  readonly code = "CONFLICT" as const;
  constructor(key: string) {
    super(`"${key}" là vai trò hệ thống — không được xoá hoặc đổi mã`);
  }
}

export class RoleInUseError extends DomainError {
  readonly code = "CONFLICT" as const;
  constructor(key: string, userCount: number) {
    super(`Vai trò "${key}" đang được gán cho ${userCount} người dùng — gỡ hết trước khi xoá`);
  }
}

/**
 * Quyền không có trong danh mục của code.
 *
 * Chặn ở đây thay vì lặng lẽ bỏ qua: ghi một quyền không tồn tại vào database
 * tạo ra bản ghi chết mà người quản trị vẫn thấy đã tick — họ tưởng đã cấp
 * quyền, mà không dòng mã nào kiểm tra nó.
 */
export class UnknownPermissionError extends DomainError {
  readonly code = "VALIDATION_ERROR" as const;
  constructor(keys: string[]) {
    super(`Quyền không tồn tại trong hệ thống: ${keys.join(", ")}`, {
      permissions: [`Quyền không tồn tại: ${keys.join(", ")}`],
    });
  }
}

export class ForbiddenError extends DomainError {
  readonly code = "FORBIDDEN" as const;
  constructor(message = "Bạn không có quyền thực hiện thao tác này") {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Bên thứ ba
// ---------------------------------------------------------------------------

export class ProviderNotConfiguredError extends DomainError {
  readonly code = "PROVIDER_ERROR" as const;
  constructor(provider: string) {
    super(`Đăng nhập bằng ${provider} chưa được cấu hình`);
  }
}

export class ProviderExchangeError extends DomainError {
  readonly code = "PROVIDER_ERROR" as const;
  constructor(provider: string, cause?: unknown) {
    super(`Không đăng nhập được bằng ${provider}. Vui lòng thử lại.`);
    this.cause = cause;
  }
}

export class OAuthEmailRequiredError extends DomainError {
  readonly code = "VALIDATION_ERROR" as const;
  constructor(provider: string) {
    super(
      `Tài khoản ${provider} của bạn không có email đã xác thực để liên kết. ` +
        `Vui lòng công khai/xác thực email trên ${provider} rồi thử lại.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Xác thực hai lớp (2FA)
// ---------------------------------------------------------------------------

/**
 * Mật khẩu ĐÚNG, nhưng tài khoản có bật 2FA — chưa cấp token thật.
 *
 * Không phải lỗi theo nghĩa thông thường: đây là một bước trong luồng đăng
 * nhập. `challengeToken` là vé đi tiếp, gửi kèm mã TOTP tới
 * `POST /auth/2fa/verify`.
 *
 * Client PHẢI phân biệt nó với 401 thật (sai mật khẩu) — đó là lý do nó có mã
 * riêng thay vì dùng chung `UNAUTHENTICATED`.
 */
export class TwoFactorRequiredError extends DomainError {
  readonly code = "TWO_FACTOR_REQUIRED" as const;
  constructor(readonly userId: string) {
    super("Tài khoản có bật xác thực hai lớp. Vui lòng nhập mã từ ứng dụng xác thực.");
  }
}

export class InvalidTwoFactorCodeError extends DomainError {
  readonly code = "UNAUTHENTICATED" as const;
  constructor() {
    super("Mã xác thực không đúng hoặc đã hết hiệu lực");
  }
}

export class TwoFactorAlreadyEnabledError extends DomainError {
  readonly code = "CONFLICT" as const;
  constructor() {
    super("Xác thực hai lớp đã được bật cho tài khoản này");
  }
}

export class TwoFactorNotEnabledError extends DomainError {
  readonly code = "CONFLICT" as const;
  constructor() {
    super("Xác thực hai lớp chưa được bật cho tài khoản này");
  }
}

/**
 * Mã dùng-một-lần bị nhập sai quá số lần cho phép.
 *
 * Tách khỏi `InvalidVerificationTokenError` vì thông điệp phải khác: người
 * dùng cần biết họ phải XIN MÃ MỚI, chứ không phải thử lại lần nữa.
 */
export class TooManyVerificationAttemptsError extends DomainError {
  readonly code = "RATE_LIMITED" as const;
  constructor() {
    super("Bạn đã nhập sai quá nhiều lần. Mã đã bị huỷ — vui lòng yêu cầu mã mới.");
  }
}

// ---------------------------------------------------------------------------
// Bậc quyền lực
// ---------------------------------------------------------------------------

/**
 * Chặn leo thang đặc quyền: thao tác lên một người ngang hoặc mạnh hơn mình,
 * hoặc gán một vai trò mạnh hơn bậc của chính mình.
 *
 * Không có chốt này thì bất kỳ ai có `user:create` đều tạo được một tài khoản
 * SUPER_ADMIN rồi đăng nhập vào đó — và chốt "không tự đổi vai trò của chính
 * mình" không cứu được, vì họ tạo tài khoản KHÁC.
 */
export class InsufficientRoleLevelError extends DomainError {
  readonly code = "FORBIDDEN" as const;
  constructor(message = "Bạn không đủ thẩm quyền để thao tác lên tài khoản hoặc vai trò này") {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Passkey (WebAuthn)
// ---------------------------------------------------------------------------

/**
 * Phản hồi passkey không hợp lệ khi ĐĂNG KÝ.
 *
 * Dùng chung cho mọi lý do — sai origin, sai RP ID, challenge không khớp, chữ
 * ký hỏng. Chi tiết chỉ đi vào log: nói rõ "origin không khớp" là đưa bản đồ
 * cấu hình cho người đang dò.
 *
 * Luồng ĐĂNG NHẬP thì dùng `InvalidCredentialsError` thay vì lỗi này — ở đó,
 * mọi thất bại phải giống hệt nhau, kể cả trường hợp passkey không tồn tại.
 */
export class WebAuthnVerificationError extends DomainError {
  readonly code = "VALIDATION_ERROR" as const;
  constructor() {
    super("Không xác minh được passkey. Vui lòng thử lại.");
  }
}

/**
 * Chốt chặn đăng nhập theo trạng thái tài khoản. Gọi ở MỌI đường vào:
 * mật khẩu, OAuth, passkey.
 *
 * Gom vào một hàm thay vì lặp `if (status === "BANNED")` ở từng service — bốn
 * chỗ kiểm tra riêng lẻ là bốn cơ hội để một đường đăng nhập mới quên mất luật.
 *
 * `INACTIVE` cố ý CŨNG bị chặn: nó nghĩa là "tạm ngưng". Nếu dự án của bạn cần
 * "chưa xác thực email thì chưa cho vào", đừng dùng trạng thái này — đã có cột
 * `emailVerifiedAt` riêng cho việc đó. Một cột một ý nghĩa.
 */
export function assertLoginAllowed(status: "ACTIVE" | "INACTIVE" | "BANNED"): void {
  if (status === "BANNED") throw new AccountBannedError();
  if (status === "INACTIVE") throw new AccountInactiveError();
}

// ---------------------------------------------------------------------------
// Xác thực số điện thoại (SMS)
// ---------------------------------------------------------------------------

/** Luồng SMS chưa được bật (`PHONE_VERIFICATION_ENABLED=0`). */
export class PhoneVerificationDisabledError extends DomainError {
  readonly code = "FORBIDDEN" as const;
  constructor() {
    super("Tính năng xác thực số điện thoại chưa được bật trên hệ thống này");
  }
}

/**
 * Xin mã quá dày hoặc quá nhiều lần trong ngày, tính trên MỘT SỐ ĐIỆN THOẠI.
 *
 * Khác `TooManyVerificationAttemptsError` (nhập sai quá nhiều): lỗi này là về
 * việc GỬI, và nó tồn tại vì mỗi tin nhắn tốn tiền thật. Rate limit theo IP
 * không cản được kẻ xoay vòng IP nhắm vào một số.
 */
export class PhoneOtpThrottledError extends DomainError {
  readonly code = "RATE_LIMITED" as const;
  constructor(retryAfterSeconds: number) {
    super(
      retryAfterSeconds >= 3600
        ? "Số điện thoại này đã nhận quá nhiều mã hôm nay. Vui lòng thử lại vào ngày mai."
        : `Vui lòng đợi ${retryAfterSeconds} giây trước khi yêu cầu mã mới.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Đặt sân
// ---------------------------------------------------------------------------

/**
 * Khung giờ vừa bị người khác lấy mất.
 *
 * Ném khi ràng buộc `EXCLUDE USING gist` ở tầng database từ chối — nghĩa là hai
 * người bấm gần như cùng lúc và người kia nhanh hơn vài mili giây. Đây là hành
 * vi ĐÚNG, không phải lỗi hệ thống: thông điệp phải nói rõ để khách chọn lại
 * ngay chứ không nghĩ là app hỏng.
 */
export class SlotTakenError extends DomainError {
  readonly code = "CONFLICT" as const;
  constructor() {
    super("Khung giờ này vừa có người đặt mất. Chọn giờ khác giúp bạn nhé.");
  }
}

/** Khung giờ không bán được: ngoài giờ mở cửa, đã qua, hoặc sân đang bảo trì. */
export class SlotUnavailableError extends DomainError {
  readonly code = "CONFLICT" as const;
  constructor(message = "Khung giờ này không đặt được") {
    super(message);
  }
}

export class BookingNotFoundError extends DomainError {
  readonly code = "NOT_FOUND" as const;
  constructor() {
    super("Không tìm thấy lượt đặt sân");
  }
}

/**
 * Thao tác không hợp lệ với trạng thái hiện tại — huỷ một lượt đã huỷ, check-in
 * một lượt chưa trả tiền.
 *
 * Thông điệp NÓI RÕ trạng thái hiện tại: "Lượt đặt đã bị huỷ" hữu ích hơn hẳn
 * "Thao tác không hợp lệ", vì nhân viên quầy đang đứng trước mặt khách.
 */
export class BookingStateError extends DomainError {
  readonly code = "CONFLICT" as const;
  constructor(message: string) {
    super(message);
  }
}

/** Huỷ sau hạn miễn phí. Vẫn huỷ được, nhưng không hoàn tiền. */
export class CancelWindowPassedError extends DomainError {
  readonly code = "CONFLICT" as const;
  constructor(readonly freeUntil: Date) {
    super("Đã quá hạn huỷ miễn phí của sân này");
  }
}

// ---------------------------------------------------------------------------
// Thanh toán
// ---------------------------------------------------------------------------

export class PaymentNotFoundError extends DomainError {
  readonly code = "NOT_FOUND" as const;
  constructor() {
    super("Không tìm thấy giao dịch thanh toán");
  }
}

/**
 * Thao tác không hợp lệ với trạng thái giao dịch — duyệt một giao dịch đã huỷ,
 * khai báo đã chuyển khoản cho một giao dịch đã thành công.
 *
 * Thông điệp nói rõ trạng thái hiện tại, vì chủ sân đọc câu này khi đang cầm
 * điện thoại đối chiếu với app ngân hàng.
 */
export class PaymentStateError extends DomainError {
  readonly code = "CONFLICT" as const;
  constructor(message: string) {
    super(message);
  }
}

/**
 * Duyệt tay một giao dịch của cổng thanh toán.
 *
 * Cổng tự báo về bằng webhook; cho phép duyệt tay nghĩa là bất kỳ ai có quyền
 * `payment:confirm` cũng đánh dấu được "đã trả tiền" cho một lượt chưa trả một
 * đồng nào. Tiền mặt và chuyển khoản tay thì ngược lại — chỉ có người mới xác
 * nhận được.
 */
export class ManualApprovalNotAllowedError extends DomainError {
  readonly code = "CONFLICT" as const;
  constructor(provider: string) {
    super(
      `Giao dịch qua ${provider} do cổng thanh toán tự xác nhận, không duyệt tay được. ` +
        "Nếu khách đã trả bằng cách khác, tạo giao dịch tiền mặt hoặc chuyển khoản.",
    );
  }
}

/**
 * Số tiền cổng báo về khác số tiền của giao dịch.
 *
 * KHÔNG tự xác nhận trong trường hợp này dù webhook nói "thành công": chênh
 * lệch nghĩa là hoặc mã đối soát bị dùng lại, hoặc có người sửa số tiền giữa
 * đường. Cả hai đều phải có người xem.
 */
export class PaymentAmountMismatchError extends DomainError {
  readonly code = "CONFLICT" as const;
  constructor(
    readonly expected: number,
    readonly received: number,
  ) {
    super(`Số tiền không khớp: giao dịch ${expected}đ, cổng báo ${received}đ`);
  }
}

/** Sân chưa khai tài khoản ngân hàng nên không dựng được mã QR chuyển khoản. */
export class VenueBankAccountMissingError extends DomainError {
  readonly code = "CONFLICT" as const;
  constructor() {
    super("Sân chưa khai tài khoản ngân hàng nên chưa nhận chuyển khoản được");
  }
}

/** Hoàn quá số tiền còn lại của giao dịch. */
export class RefundAmountError extends DomainError {
  readonly code = "CONFLICT" as const;
  constructor(readonly remaining: number) {
    super(`Chỉ còn ${remaining.toLocaleString("vi-VN")}đ có thể hoàn`);
  }
}

// ---------------------------------------------------------------------------
// Cơ sở và sân con
// ---------------------------------------------------------------------------

export class VenueNotFoundError extends DomainError {
  readonly code = "NOT_FOUND" as const;
  constructor() {
    super("Không tìm thấy cơ sở");
  }
}

export class CourtNotFoundError extends DomainError {
  readonly code = "NOT_FOUND" as const;
  constructor() {
    super("Không tìm thấy sân");
  }
}

/**
 * Cấu hình sân sai — giờ mở cửa lệch khung, giá âm, khoảng thời gian ngược.
 *
 * Tách khỏi `ForbiddenError` vì đây là lỗi DỮ LIỆU chứ không phải lỗi quyền:
 * người dùng có quyền làm việc này, chỉ là số liệu nhập vào không dùng được.
 */
export class VenueConfigError extends DomainError {
  readonly code = "VALIDATION_ERROR" as const;
  constructor(message: string) {
    super(message);
  }
}

/**
 * Chưa đủ điều kiện mở bán.
 *
 * Mang theo danh sách thứ còn thiếu để giao diện chỉ thẳng vào chỗ cần sửa,
 * thay vì bắt chủ sân đi dò từng màn xem thiếu gì.
 */
export class VenueNotReadyError extends DomainError {
  readonly code = "CONFLICT" as const;
  constructor(readonly missing: string[]) {
    super(`Chưa mở bán được: sân còn thiếu ${missing.join(", ")}`);
  }
}
