import "server-only";

// Deliberately allow only the two destinations used by our booking flow.
// Validate again in the action: hidden form fields are editable by the browser.
export function safeReturnTo(value: unknown): string {
  if (typeof value === "string" && value.length <= 127 && (value === "/bookings" || /^\/shows\/[A-Za-z0-9-]+$/.test(value))) {
    return value;
  }
  return "/account";
}
