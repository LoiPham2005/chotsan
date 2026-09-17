"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { fieldClassName, Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/cn";
import { createVenueAction, type NewVenueState } from "./actions";

const LABEL = "mb-1 block text-xs font-bold uppercase tracking-wide text-subtle";

/**
 * Form đăng ký cơ sở mới — chỉ những trường BẮT BUỘC để có một bản nháp. Giờ mở
 * cửa, sân con, bảng giá, tài khoản nhận tiền khai ở trang cài đặt ngay sau đó:
 * dồn tất cả vào một form dài là cách nhanh nhất để người ta bỏ ngang.
 *
 * Báo lỗi thì mọi ô dựng lại bằng đúng chữ vừa gõ (`state.values`) — React 19
 * đã xoá trắng form sau khi action chạy xong.
 */
export function NewVenueForm({ sports }: { sports: { id: string; name: string }[] }) {
  const [state, create] = useActionState<NewVenueState, FormData>(createVenueAction, {});
  const values = state.values ?? {};

  return (
    <form
      action={create}
      className="mt-6 grid gap-4 rounded-token-lg border border-line bg-surface p-4 sm:p-5"
    >
      <div>
        <label htmlFor="venue-name" className={LABEL}>
          Tên cơ sở
        </label>
        <Input
          id="venue-name"
          name="name"
          required
          minLength={2}
          maxLength={120}
          autoComplete="organization"
          placeholder="Ví dụ: Sân cầu lông Thành Công"
          defaultValue={values.name}
        />
      </div>

      <div>
        <label htmlFor="venue-sport" className={LABEL}>
          Môn chính
        </label>
        {/* `key` theo giá trị vừa gửi: select không nhận `defaultValue` mới sau
            lần dựng đầu, phải dựng lại mới giữ được lựa chọn khi báo lỗi. */}
        <select
          key={values.sportId ?? ""}
          id="venue-sport"
          name="sportId"
          required
          defaultValue={values.sportId ?? ""}
          className={cn(fieldClassName, "h-11 cursor-pointer")}
        >
          <option value="" disabled>
            Chọn môn thể thao
          </option>
          {sports.map((sport) => (
            <option key={sport.id} value={sport.id}>
              {sport.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="venue-address" className={LABEL}>
            Số nhà, tên đường
          </label>
          <Input
            id="venue-address"
            name="address"
            required
            minLength={2}
            maxLength={200}
            autoComplete="street-address"
            placeholder="168 Thái Hà"
            defaultValue={values.address}
          />
        </div>

        <div>
          <label htmlFor="venue-ward" className={LABEL}>
            Phường/xã
          </label>
          <Input
            id="venue-ward"
            name="ward"
            required
            maxLength={100}
            placeholder="Phường Láng Hạ"
            defaultValue={values.ward}
          />
        </div>

        <div>
          <label htmlFor="venue-province" className={LABEL}>
            Tỉnh/thành phố
          </label>
          <Input
            id="venue-province"
            name="province"
            required
            maxLength={100}
            placeholder="Hà Nội"
            defaultValue={values.province}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="venue-phone" className={LABEL}>
            Số điện thoại của sân
          </label>
          <Input
            id="venue-phone"
            name="phone"
            type="tel"
            required
            inputMode="tel"
            autoComplete="tel"
            pattern="0[0-9]{9,10}"
            placeholder="0987654321"
            hint="Khách gọi số này khi cần; ChốtSân cũng liên hệ số này khi duyệt hồ sơ."
            defaultValue={values.phone}
          />
        </div>
      </div>

      <div>
        <label htmlFor="venue-description" className={LABEL}>
          Giới thiệu ngắn{" "}
          <span className="font-medium normal-case text-muted">— không bắt buộc</span>
        </label>
        <textarea
          id="venue-description"
          name="description"
          rows={3}
          maxLength={500}
          placeholder="Số sân, loại mặt sân, đèn, chỗ để xe…"
          defaultValue={values.description}
          className={cn(fieldClassName, "py-2")}
        />
      </div>

      {state.error && (
        <Notice tone="danger" role="alert">
          {state.error}
        </Notice>
      )}

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending ? "Đang tạo…" : "Tạo bản nháp và khai tiếp"}
    </Button>
  );
}
