import { formatVndShort } from "@/lib/slots";

/**
 * Cột doanh thu theo ngày.
 *
 * ---
 * VẼ BẰNG `div`, KHÔNG KÉO THƯ VIỆN BIỂU ĐỒ
 *
 * Đây là một dãy cột cùng thang đo — thứ CSS làm được bằng chiều cao phần trăm.
 * Kéo Recharts về cho việc này là thêm ~90KB JavaScript vào một trang mà toàn
 * bộ dữ liệu đã có sẵn ở máy chủ, và biến một Server Component thành Client.
 *
 * ---
 * SỐ LIỆU CÓ CẢ Ở DẠNG BẢNG
 *
 * Biểu đồ cột không đọc được bằng trình đọc màn hình. `<table>` ẩn bên dưới
 * mang đúng dữ liệu đó — không phải bản tóm tắt, mà chính nó.
 */
export function RevenueChart({
  rows,
}: {
  rows: { date: string; bookings: number; revenue: number }[];
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-token-lg border border-dashed border-line bg-surface p-8 text-center text-sm text-muted">
        Chưa có lượt đặt nào đã chốt trong khoảng này.
      </p>
    );
  }

  const max = Math.max(...rows.map((row) => row.revenue), 1);

  return (
    <figure className="rounded-token-lg border border-line bg-surface p-4 shadow-nang-1">
      <div className="flex h-40 items-end gap-1" aria-hidden>
        {rows.map((row) => (
          <div key={row.date} className="group relative flex-1" title={`${row.date}`}>
            <div
              className="w-full rounded-t-[3px] bg-gradient-to-t from-brand to-emerald-400 transition-opacity group-hover:opacity-80"
              style={{ height: `${Math.max(2, (row.revenue / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>

      <div className="mt-2 flex justify-between border-t border-line pt-2 text-xs text-subtle">
        <span>
          {rows[0]!.date.slice(8)}/{rows[0]!.date.slice(5, 7)}
        </span>
        <span>cao nhất {formatVndShort(max)}</span>
        <span>
          {rows.at(-1)!.date.slice(8)}/{rows.at(-1)!.date.slice(5, 7)}
        </span>
      </div>

      <table className="sr-only">
        <caption>Doanh thu theo ngày</caption>
        <thead>
          <tr>
            <th scope="col">Ngày</th>
            <th scope="col">Số lượt</th>
            <th scope="col">Doanh thu</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.date}>
              <th scope="row">{row.date}</th>
              <td>{row.bookings}</td>
              <td>{row.revenue}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
