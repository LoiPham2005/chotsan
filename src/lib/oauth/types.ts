/**
 * Bốn provider hỗ trợ — NGUỒN DUY NHẤT của danh sách này (schema, route và
 * giao diện đều import từ đây). Union cứng: thêm provider mới bắt buộc phải cập
 * nhật `PROVIDER_CONFIG` trong `config.ts`, TypeScript bắt mọi chỗ còn thiếu.
 *
 * Lớp lỗi OAuth KHÔNG nằm ở đây mà ở `@/lib/errors` — xem ghi chú ở đó.
 */
export const OAUTH_PROVIDERS = ["google", "github", "facebook", "apple"] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProviderId(value: string): value is OAuthProviderId {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Hồ sơ đã chuẩn hoá, giống nhau bất kể provider nào — phần còn lại của hệ
 * thống (route callback, `oauthService`) không cần biết Google khác Github ở
 * đâu.
 */
export type OAuthProfile = {
  provider: OAuthProviderId;
  providerAccountId: string;
  /** null nếu provider không trả email (vd Github ẩn email) hoặc chưa xác thực. */
  email: string | null;
  fullName: string | null;
};
