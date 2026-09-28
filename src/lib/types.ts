/** Shared by the API, the store and the browser — no node-only imports here. */

export interface Reservation {
  id: string;
  seatId: string;
  /** YYYY-MM-DD */
  date: string;
  /** slot index, inclusive */
  start: number;
  /** slot index, exclusive */
  end: number;
  name: string;
  /** the student's college address */
  studentId: string;
  createdAt: string;
}

/**
 * A taken slot, as every visitor sees it. Deliberately carries nothing that
 * identifies the student — the booking page needs occupancy, never identity.
 */
export interface Occupancy {
  seatId: string;
  /** slot index, inclusive */
  start: number;
  /** slot index, exclusive */
  end: number;
}
