const showDateTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

const ticketPrice = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export function formatShowTime(value: string): string {
  return showDateTime.format(new Date(value));
}

export function formatPrice(priceInPaise: number): string {
  return ticketPrice.format(priceInPaise / 100);
}
