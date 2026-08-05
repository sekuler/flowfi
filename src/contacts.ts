const ADDRESS_BOOK_KEY = "flowfi-address-book";

export interface Contact {
  name: string;
  address: string;
}

export function loadContacts(): Contact[] {
  try {
    return JSON.parse(localStorage.getItem(ADDRESS_BOOK_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveContacts(contacts: Contact[]) {
  localStorage.setItem(ADDRESS_BOOK_KEY, JSON.stringify(contacts));
}

// Looks up a saved contact name for an address, if one exists. Case-insensitive.
export function contactNameFor(address: string): string | null {
  const contacts = loadContacts();
  const match = contacts.find((c) => c.address.toLowerCase() === address.toLowerCase());
  return match?.name ?? null;
}
