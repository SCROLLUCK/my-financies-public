const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export const formatBRL = (value: number | string): string =>
  brl.format(typeof value === "string" ? parseFloat(value) : value);

/** Always renders date + time (dd/mm/yyyy hh:mm). Accepts date-only or full ISO datetimes. */
export const formatDateTime = (iso: string): string => {
  const d = new Date(iso.includes("T") ? iso : `${iso}T00:00:00`);
  const date = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return `${date} ${time}`;
};

/** Time only (hh:mm). Accepts full ISO datetimes. */
export const formatTime = (iso: string): string =>
  new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso)
  );

/** Date only (dd/mm/yyyy). Accepts date-only or full ISO datetimes. */
export const formatDate = (iso: string): string =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso.includes("T") ? iso : `${iso}T00:00:00`));

/** Local date as YYYY-MM-DD (for date-only API fields). */
export const toYMD = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

/** Current month as YYYY-MM in local time. */
export const currentMonth = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};
