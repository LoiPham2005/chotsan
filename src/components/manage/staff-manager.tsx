"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  inviteStaffAction,
  removeStaffAction,
  setStaffPermissionsAction,
  type StaffState,
} from "@/app/(manage)/manage/[venueId]/staff/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Nhãn tiếng Việt cho từng quyền tick được.
 *
 * Viết theo VIỆC người đó làm được, không theo tên khoá. Chủ sân không biết
 * `payment:confirm` là gì, nhưng biết ngay "Xác nhận đã nhận tiền chuyển khoản".
 */
const LABEL: Record<string, { title: string; hint: string }> = {
  "payment:confirm": {
    title: "Xác nhận đã nhận tiền",
    hint: "Duyệt các khoản khách báo đã chuyển khoản",
  },
  "booking:cancel": { title: "Huỷ lượt đặt", hint: "Huỷ hộ khách khi họ gọi tới" },
  "booking:reschedule": { title: "Đổi giờ lượt đặt", hint: "Chuyển sang khung giờ hoặc sân khác" },
  "payment:refund": { title: "Hoàn tiền", hint: "⚠️ Tiền ra khỏi tài khoản" },
  "pricing:update": { title: "Sửa bảng giá", hint: "Đổi giá và khung giờ vàng" },
  "court:update": { title: "Sửa sân con", hint: "Thêm, tắt, đổi thông tin sân" },
  "venue:update": { title: "Sửa hồ sơ sân", hint: "Tên, mô tả, giờ mở cửa, tài khoản ngân hàng" },
  "report:read": { title: "Xem báo cáo", hint: "Doanh thu và thống kê" },
  "member:manage": { title: "Quản lý nhân sự", hint: "Mời và gỡ nhân viên khác" },
};

export type StaffMember = {
  id: string;
  role: string;
  name: string;
  email: string | null;
  permissions: string[];
};

/**
 * Nhân sự của cơ sở.
 *
 * ---
 * BA QUYỀN NGUY HIỂM KHÔNG CÓ Ô ĐỂ TICK
 *
 * Rút tiền, xoá sân, chuyển nhượng sân không xuất hiện ở đây — không phải hiện
 * ra rồi cảnh báo khi bấm. Một cú bấm nhầm là mất trắng và chủ sân sẽ không
 * hiểu mình vừa làm gì. Service cũng chặn lại lần nữa.
 */
export function StaffManager({
  venueId,
  members,
  grantable,
}: {
  venueId: string;
  members: StaffMember[];
  grantable: string[];
}) {
  const [state, invite] = useActionState<StaffState, FormData>(
    inviteStaffAction.bind(null, venueId),
    {},
  );

  return (
    <>
      <section aria-labelledby="moi">
        <h2 id="moi" className="text-lg font-bold text-content">
          Mời nhân viên
        </h2>
        <p className="mt-1 text-sm text-muted">
          Người được mời phải có tài khoản ChốtSân sẵn. Họ vào được ngay, với bộ quyền trực sân cơ
          bản.
        </p>

        <form action={invite} className="mt-3 flex flex-wrap gap-2">
          <Input
            name="email"
            type="email"
            required
            placeholder="email của nhân viên"
            className="min-w-[16rem] flex-1"
          />
          <InviteButton />
        </form>

        {state.error && (
          <p role="alert" className="alert alert-danger mt-2">
            {state.error}
          </p>
        )}
        {state.ok && (
          <p role="status" className="mt-2 text-sm font-medium text-brand-hover">
            {state.ok}
          </p>
        )}
      </section>

      <section className="mt-8" aria-labelledby="ds">
        <h2 id="ds" className="text-lg font-bold text-content">
          Đang làm việc
          <span className="ml-2 text-sm font-medium text-muted">{members.length} người</span>
        </h2>

        <ul className="mt-3 space-y-3">
          {members.map((member) => (
            <MemberRow key={member.id} venueId={venueId} member={member} grantable={grantable} />
          ))}
        </ul>
      </section>
    </>
  );
}

function MemberRow({
  venueId,
  member,
  grantable,
}: {
  venueId: string;
  member: StaffMember;
  grantable: string[];
}) {
  const [savedState, save] = useActionState<StaffState, FormData>(
    setStaffPermissionsAction.bind(null, venueId),
    {},
  );
  const [removeState, remove] = useActionState<StaffState, FormData>(
    removeStaffAction.bind(null, venueId),
    {},
  );
  const [open, setOpen] = useState(false);
  const isOwner = member.role === "OWNER";

  return (
    <li className="rounded-token-lg border border-line bg-surface p-4 shadow-nang-1">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-content">{member.name}</p>
          {member.email && <p className="truncate text-sm text-muted">{member.email}</p>}
        </div>

        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${
            isOwner
              ? "bg-brand-tint text-brand-hover ring-brand-line"
              : "bg-elevated text-muted ring-line"
          }`}
        >
          {isOwner ? "Chủ sân" : "Nhân viên"}
        </span>

        {!isOwner && (
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(!open)}>
              {open ? "Đóng" : `Quyền (${member.permissions.length})`}
            </Button>
            <form action={remove}>
              <input type="hidden" name="memberId" value={member.id} />
              <RemoveButton />
            </form>
          </>
        )}
      </div>

      {isOwner && (
        <p className="mt-2 text-sm text-muted">
          Chủ sân luôn có mọi quyền, kể cả rút tiền và chuyển nhượng sân.
        </p>
      )}

      {(savedState.error ?? removeState.error) && (
        <p role="alert" className="alert alert-danger mt-3">
          {savedState.error ?? removeState.error}
        </p>
      )}
      {savedState.ok && (
        <p role="status" className="mt-2 text-sm font-medium text-brand-hover">
          {savedState.ok}
        </p>
      )}

      {open && !isOwner && (
        <form action={save} className="mt-3 border-t border-line pt-3">
          <input type="hidden" name="memberId" value={member.id} />

          <fieldset>
            <legend className="text-sm font-semibold text-content">Tick thêm quyền</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {grantable.map((key) => {
                const label = LABEL[key] ?? { title: key, hint: "" };
                return (
                  <label
                    key={key}
                    className="flex cursor-pointer items-start gap-2 rounded-token-md border border-line p-2.5 transition hover:border-brand-line hover:bg-brand-tint/40"
                  >
                    <input
                      type="checkbox"
                      name="permissions"
                      value={key}
                      defaultChecked={member.permissions.includes(key)}
                      className="mt-0.5 h-4 w-4 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-content">{label.title}</span>
                      <span className="block text-xs text-muted">{label.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-3">
            <SaveButton />
          </div>
        </form>
      )}
    </li>
  );
}

function InviteButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Đang mời…" : "Mời vào sân"}
    </Button>
  );
}
function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Đang lưu…" : "Lưu quyền"}
    </Button>
  );
}
function RemoveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="ghost" disabled={pending}>
      {pending ? "…" : "Gỡ"}
    </Button>
  );
}
