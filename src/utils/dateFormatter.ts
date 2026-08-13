import { parseISO, format, isBefore, startOfToday, parse, isValid } from 'date-fns';

/**
 * Returns a uniform formatted date string for the application.
 * Default format: DD/MM/YYYY
 */
export const formatDisplayDate = (dateString: string | Date | null | undefined): string => {
  if (!dateString) return 'N/A';
  
  try {
    let dateObj;
    if (typeof dateString === 'string') {
      // If it contains slashes, force MM/dd/yyyy parsing to prevent locale flip (Sept 5 = 09/05/2026)
      if (dateString.includes('/')) {
        dateObj = parse(dateString, 'MM/dd/yyyy', new Date());
        if (!isValid(dateObj)) dateObj = parseISO(dateString); // fallback
      } else {
        dateObj = parseISO(dateString);
      }
    } else {
      dateObj = dateString;
    }
    
    if (!isValid(dateObj)) return 'Invalid Date';
    return format(dateObj, 'dd/MM/yyyy');
  } catch (error) {
    console.error('Date parsing error for display:', error);
    return 'Invalid Date';
  }
};

/**
 * Parses a date as typed by a human into a `YYYY-MM-DD` string, or null if it
 * is not a date this app accepts. Used by the CSV importer.
 *
 * Accepts `YYYY-MM-DD` and `DD/MM/YYYY` (also `DD-MM-YYYY`). Day-first is
 * deliberate and matches the display format used everywhere else in the app —
 * an Indian school writing 05/09/2026 means 5 September, and silently reading
 * it as 9 May would corrupt the record with no error to notice.
 */
export const parseInputDate = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const s = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return isValid(parseISO(s)) ? s : null;
  }

  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  // parseISO accepts 2026-02-31, so check the round-trip rather than trusting it.
  const parsed = parseISO(iso);
  return isValid(parsed) && format(parsed, 'yyyy-MM-dd') === iso ? iso : null;
};

/**
 * Returns the weekday name for a date (e.g. "Sunday" or "Sun").
 * Accepts a `YYYY-MM-DD` string, an ISO string, or a Date.
 */
export const getWeekdayName = (
  dateInput: string | Date | null | undefined,
  style: 'short' | 'long' = 'long'
): string => {
  if (!dateInput) return '';
  const dateObj = typeof dateInput === 'string' ? parseISO(dateInput) : dateInput;
  if (!isValid(dateObj)) return '';
  return format(dateObj, style === 'long' ? 'EEEE' : 'EEE');
};

/**
 * True if the given date falls on a Sunday — used to flag likely-holiday
 * dates in scheduling UI so a counsellor notices before booking on one.
 */
export const isSunday = (dateInput: string | Date | null | undefined): boolean => {
  if (!dateInput) return false;
  const dateObj = typeof dateInput === 'string' ? parseISO(dateInput) : dateInput;
  if (!isValid(dateObj)) return false;
  return dateObj.getDay() === 0;
};

/**
 * Checks if a given date string is strictly overdue (before today).
 * Uses explicit parsing to handle database strings accurately and avoid locale issues.
 */
export const isOverdue = (dateString: string | null | undefined): boolean => {
  if (!dateString) return false;
  
  try {
    let dateObj;
    if (dateString.includes('/')) {
      dateObj = parse(dateString, 'MM/dd/yyyy', new Date());
      if (!isValid(dateObj)) dateObj = parseISO(dateString);
    } else {
      dateObj = parseISO(dateString);
    }
    
    if (!isValid(dateObj)) return false;
    return isBefore(dateObj, startOfToday());
  } catch (error) {
    console.error('Date parsing error for overdue check:', error);
    return false;
  }
};
