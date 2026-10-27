import { Text } from "ink";
import { COLOR } from "../theme";

export function Rule({ width }: { width: number }) {
  return <Text color={COLOR.rule}>{"─".repeat(Math.max(1, width))}</Text>;
}
