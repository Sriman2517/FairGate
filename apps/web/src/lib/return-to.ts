import "server-only";

// Deliberately allow only known booking and operator destinations.
// Validate again in the action: hidden form fields are editable by the browser.
export function safeReturnTo(value: unknown): string {
  if (typeof value === "string" && value.length <= 127 && (value === "/bookings" || value === "/operations" || /^\/shows\/[A-Za-z0-9-]+$/.test(value))) {
    return value;
  }
  return "/account";
}
