// Opens the ⌘K command palette from anywhere (sidebar, mobile bar, pages).
export const PALETTE_EVENT = 'upsych-palette';
export const openPalette = () => window.dispatchEvent(new Event(PALETTE_EVENT));
