import type { Metadata } from "next";
import { IndicatorBoard } from "@/components/IndicatorBoard";

export const metadata: Metadata = { title: "경제지표" };

export default function IndicatorsPage() {
  return <IndicatorBoard />;
}
