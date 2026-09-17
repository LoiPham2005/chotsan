import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { userService } from "@/services/user.service";
import { UserForm } from "./user-form";
import { UserDeleteButton } from "./user-delete-button";
import { UserStatusButton } from "./user-status-button";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Quản lý người dùng" };
export const dynamic = "force-dynamic";

/**
 * Số dòng mỗi trang.
 *
 * 20 chứ không phải 50: danh sách này có nút Khoá và Xoá ở mỗi dòng, và trang
 * càng dài thì càng dễ bấm nhầm dòng bên cạnh.
 */
const PER_PAGE = 20;

/** Nhãn nhỏ cạnh tên — trạng thái nói bằng CẢ màu LẪN chữ (SKILL.md §1, luật 4). */
const TAG = {
  neutral: "bg-elevated text-muted ring-line",
  danger: "bg-danger-tint text-danger-text ring-danger-line",
  brand: "bg-brand-tint text-brand-text ring-brand-line",
} as const;

function Tag({ tone, children }: { tone: keyof typeof TAG; children: React.ReactNode }) {
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${TAG[tone]}`}
    >
      {children}
    </span>
  );
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  // Lớp bảo vệ ở tầng trang. Server Action còn tự kiểm tra lại một lần nữa —
  // xem `actions.ts` để biết vì sao không thể chỉ dựa vào chỗ này.
  const currentUser = await requirePermission("user:read", "/users");

  const { page } = await searchParams;

  /*
   * `userService.list` trả cả `items` lẫn `meta` (tổng số, số trang, còn trang
   * sau không) trong MỘT lần gọi — trước đây phải gọi thêm `count()` riêng, và
   * hai truy vấn đó có thể thấy hai trạng thái khác nhau của bảng.
   */
  const currentPage = Number(page) || 1;
  const { items: users, meta } = await userService.list({
    page: currentPage,
    limit: PER_PAGE,
    includeDeleted: false,
  });

  return (
    // Lề và khoảng đệm do `(admin)/layout.tsx` lo — trang chỉ giới hạn bề rộng chữ.
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight text-content sm:text-3xl">
        Quản lý người dùng
      </h1>
      <p className="mt-1 text-sm text-muted">
        <span className="font-semibold text-content">{meta.total}</span> người dùng
      </p>

      <section
        aria-labelledby="new-user-heading"
        className="mt-6 rounded-token-lg border border-line bg-surface p-4 sm:p-5"
      >
        <h2 id="new-user-heading" className="text-lg font-bold text-content">
          Thêm người dùng mới
        </h2>
        <p className="mb-4 mt-1 text-sm text-muted">
          Tài khoản mới mang vai trò USER và chưa có mật khẩu — người dùng tự đặt qua “Quên mật
          khẩu”.
        </p>
        <UserForm />
      </section>

      <section aria-labelledby="user-list-heading" className="mt-8">
        <h2 id="user-list-heading" className="text-lg font-bold text-content">
          Danh sách người dùng
        </h2>

        {users.length === 0 ? (
          <p className="mt-3 rounded-token-lg border border-dashed border-line bg-surface p-8 text-center text-sm text-muted">
            Chưa có người dùng nào trong cơ sở dữ liệu.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {users.map((user: (typeof users)[number]) => {
              const identity = user.email ?? user.username ?? "";
              const lockedNow =
                user.status === "ACTIVE" &&
                user.lockedUntil !== null &&
                user.lockedUntil > new Date();

              return (
                // Điện thoại: nút xuống dưới thông tin — đứng cạnh nhau thì email bị
                // cắt còn vài chữ, mà email là thứ quản trị viên đọc để khỏi bấm nhầm.
                <li
                  key={user.id}
                  className="flex flex-col gap-3 rounded-token-lg border border-line bg-surface p-3 sm:flex-row sm:items-start sm:p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-content">{identity}</p>
                    <p className="mt-0.5 flex flex-wrap gap-x-2 text-sm text-muted">
                      {user.fullName && <span>{user.fullName}</span>}
                      {user.username && <span>@{user.username}</span>}
                      <span>tạo {formatDate(user.createdAt)}</span>
                    </p>
                    <p className="mt-1.5 flex flex-wrap gap-1.5">
                      {user.roles.map((role) => (
                        <Tag key={role} tone="neutral">
                          {role}
                        </Tag>
                      ))}
                      {user.status === "BANNED" && <Tag tone="danger">Đã khoá</Tag>}
                      {lockedNow && <Tag tone="neutral">Khoá tạm (sai mật khẩu)</Tag>}
                      {user.id === currentUser.id && <Tag tone="brand">Bạn</Tag>}
                    </p>
                  </div>

                  {/* Không có nút cho CHÍNH MÌNH — service cũng chặn tự khoá/tự xoá. */}
                  {user.id !== currentUser.id && (
                    <div className="flex min-w-0 flex-wrap items-start gap-2">
                      <UserStatusButton
                        id={user.id}
                        email={identity}
                        status={user.status}
                        lockedUntil={user.lockedUntil?.toISOString() ?? null}
                      />
                      <UserDeleteButton id={user.id} email={identity} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/*
          Phân trang theo SỐ TRANG, không phải cursor.

          Cursor cuộn vô hạn tốt hơn, nhưng màn quản trị cần nhảy tới "trang 7"
          và cần biết TỔNG số bản ghi — cursor không cho cả hai. Mỗi trang là
          một URL riêng nên nút Back của trình duyệt vẫn làm đúng việc của nó.
        */}
        {(meta.page > 1 || meta.hasNext) && (
          <nav
            aria-label="Phân trang"
            className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"
          >
            <span className="text-sm text-muted">
              Trang {meta.page}/{meta.totalPages} · {meta.total} người dùng
            </span>

            <div className="flex gap-2">
              {meta.page > 1 && (
                <Button asChild variant="outline" size="sm">
                  <Link href={{ pathname: "/users", query: { page: meta.page - 1 } }}>
                    ← Trang trước
                  </Link>
                </Button>
              )}
              {meta.hasNext && (
                <Button asChild variant="outline" size="sm">
                  <Link href={{ pathname: "/users", query: { page: meta.page + 1 } }}>
                    Trang sau →
                  </Link>
                </Button>
              )}
            </div>
          </nav>
        )}
      </section>
    </div>
  );
}
