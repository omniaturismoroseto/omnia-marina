import { describe, expect, it } from "vitest";
import { contractNumberLabel, firstFreeSeq, formatContractNumber, seqGaps } from "../src/lib/contract-numbers";

describe("numerazione dei contratti", () => {
  it("il primo numero dell'anno è 1, poi si prosegue", () => {
    expect(firstFreeSeq([])).toEqual({ seq: 1, fillsGap: false });
    expect(firstFreeSeq([1, 2, 3])).toEqual({ seq: 4, fillsGap: false });
  });

  it("un numero rimasto libero viene ripreso per primo", () => {
    expect(firstFreeSeq([1, 2, 4, 5])).toEqual({ seq: 3, fillsGap: true });
    expect(firstFreeSeq([2, 3])).toEqual({ seq: 1, fillsGap: true });
  });

  it("i buchi sono i numeri mancanti sotto il più alto", () => {
    expect(seqGaps([1, 2, 4, 7])).toEqual([3, 5, 6]);
    expect(seqGaps([1, 2, 3])).toEqual([]);
    expect(seqGaps([])).toEqual([]);
  });

  it("formato e bozze", () => {
    expect(formatContractNumber(2026, 15)).toBe("2026/0015");
    expect(contractNumberLabel(null)).toBe("Bozza");
    expect(contractNumberLabel("2026/0001")).toBe("2026/0001");
  });
});
