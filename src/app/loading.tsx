export default function Loading() {
  return (
    <main className="container">
      <div className="card" style={{ textAlign: "center", padding: 48 }}>
        <div className="spinner" aria-hidden="true" />
        <p style={{ color: "var(--text-muted)", marginTop: 16 }}>Đang tải…</p>
        <span className="sr-only">Đang tải nội dung</span>
      </div>
    </main>
  );
}
