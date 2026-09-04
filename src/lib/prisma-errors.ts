/**
 * Đọc chi tiết vi phạm ràng buộc từ lỗi Prisma.
 *
 * ---
 * VÌ SAO PHẢI CÓ TỆP NÀY
 *
 * Prisma 7 dùng driver adapter, và hình dạng lỗi KHÔNG như tài liệu cũ mô tả:
 *
 *   error.message = "Unique constraint failed on the fields: (`booking_id`)"
 *   error.meta    = { modelName, driverAdapterError: { cause: {
 *                     originalCode: "23505",
 *                     originalMessage: 'duplicate key value violates unique
 *                                       constraint "ten_rang_buoc"',
 *                     constraint: { fields: ["booking_id"] } } } }
 *
 * `meta.đích` — thứ mọi ví dụ trên mạng dùng — KHÔNG CÒN TỒN TẠI, và TÊN
 * ràng buộc chỉ có trong `originalMessage`. Dò bằng `message.includes(...)` là
 * không bao giờ khớp, mà lỗi lại im lặng: nhánh bắt lỗi không chạy, lỗi bung
 * lên thành 500.
 *
 * Đây là lỗi đã xảy ra thật ở `PaymentService.ngay()` và chỉ lộ ra khi chạy
 * `pnpm db:check-conflict` trên database thật — mock luôn trả đúng hình dạng
 * mà người viết test tưởng tượng ra.
 */

type PrismaLikeError = {
  code?: string;
  message?: string;
  meta?: {
    target?: unknown;
    driverAdapterError?: {
      cause?: {
        originalCode?: string;
        originalMessage?: string;
        constraint?: { name?: string; fields?: string[] };
      };
    };
  };
};

function asPrismaError(error: unknown): PrismaLikeError | null {
  return error instanceof Error ? error : null;
}

/** Mọi chỗ tên ràng buộc có thể nấp, gộp thành một chuỗi để dò. */
function constraintText(error: PrismaLikeError): string {
  const cause = error.meta?.driverAdapterError?.cause;

  return [error.message, cause?.originalMessage, cause?.constraint?.name]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
}

/** Mọi chỗ tên cột có thể nấp. */
function violatedFields(error: PrismaLikeError): string[] {
  const fromAdapter = error.meta?.driverAdapterError?.cause?.constraint?.fields ?? [];
  const target = error.meta?.target;
  const fromTarget = Array.isArray(target) ? target : typeof target === "string" ? [target] : [];

  // Bản thân thông điệp: "Unique constraint lỗi on the fields: (`a`,`b`)".
  const fromMessage = [...(error.message ?? "").matchAll(/`([a-z0-9_]+)`/gi)]
    .map((match) => match[1])
    .filter((field): field is string => field !== undefined);

  const fromTargetStrings = fromTarget.filter(
    (field): field is string => typeof field === "string",
  );

  return [...new Set([...fromAdapter, ...fromTargetStrings, ...fromMessage])];
}

/**
 * Lỗi này có phải vi phạm ràng buộc DUY NHẤT của đúng ràng buộc/cột đang quan
 * tâm không.
 *
 * `constraint` khớp theo tên ràng buộc HOẶC tên cột — tuỳ ràng buộc, Postgres
 * báo về cái nào cũng có, và gọi bên ngoài không cần biết cái nào.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const prismaError = asPrismaError(error);
  if (!prismaError) return false;

  const isUnique =
    prismaError.code === "P2002" ||
    prismaError.meta?.driverAdapterError?.cause?.originalCode === "23505";

  if (!isUnique) return false;
  if (!constraint) return true;

  return (
    constraintText(prismaError).includes(constraint) ||
    violatedFields(prismaError).some((field) => field.includes(constraint))
  );
}

/**
 * Lỗi này có phải vi phạm ràng buộc `EXCLUDE` (mã Postgres 23P01) không.
 *
 * Prisma KHÔNG ánh xạ 23P01 thành mã P2xxx nào, nên lỗi tới dưới dạng gần như
 * thô — phải nhận diện bằng mã Postgres hoặc tên ràng buộc.
 */
export function isExclusionViolation(error: unknown, constraint?: string): boolean {
  const prismaError = asPrismaError(error);
  if (!prismaError) return false;

  const text = constraintText(prismaError);
  const isExclusion =
    prismaError.meta?.driverAdapterError?.cause?.originalCode === "23P01" ||
    text.includes("23P01") ||
    text.includes("exclusion constraint");

  if (!isExclusion) return false;
  return constraint ? text.includes(constraint) : true;
}
